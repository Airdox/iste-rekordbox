"""Create a playable fixture and verify a playlist re-exported by Rekordbox."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import struct
import sys
import wave
from contextlib import closing
from pathlib import Path, PureWindowsPath
from urllib.parse import unquote, urlsplit
from uuid import uuid4

def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_wav(path, frequency):
    rate = 44_100
    samples = bytearray()
    for frame in range(rate):
        samples.extend(struct.pack("<h", int(2500 * math.sin(2 * math.pi * frequency * frame / rate))))
    with wave.open(str(path), "wb") as audio:
        audio.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        audio.writeframes(samples * 8)


def create_fixture(directory):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from fixtures import generate

    library = directory / "master.db"
    generate(library, 3)
    tracks = []
    audio_dir = directory / "Cuepoint Test Audio"
    audio_dir.mkdir()
    with closing(sqlite3.connect(library)) as conn, conn:
        for track_id, name, frequency in (("3", "Zulu Äther", 440), ("1", "Alpha Über", 330), ("2", "Mitte Öl", 550)):
            file = audio_dir / f"{name}.wav"
            write_wav(file, frequency)
            conn.execute(
                "UPDATE djmdContent SET Title=?, FolderPath=?, Length=?, FileSize=? WHERE ID=?",
                (name, str(file), 8, file.stat().st_size, track_id),
            )
            tracks.append({"id": track_id, "title": name, "path": str(file), "sha256": sha256(file)})
    manifest = {"playlist": f"Cuepoint-QA-{uuid4().hex[:10]}", "tracks": tracks, "librarySha256": sha256(library)}
    (directory / "fixture.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def windows_path(value, playlist):
    if value.lower().startswith("file:"):
        parts = urlsplit(value)
        if parts.query or parts.fragment:
            raise ValueError(f"unexpected file URI query or fragment: {value}")
        local = unquote(parts.path)
        if parts.netloc.lower() not in {"", "localhost"}:
            local = "//" + parts.netloc + local
        value = local.lstrip("/") if re.match(r"^/[A-Za-z]:/", local) else local
    path = PureWindowsPath(value)
    return path if path.is_absolute() else PureWindowsPath(playlist.parent) / path


def entries(file):
    lines = file.read_text(encoding="utf-8-sig").splitlines()
    return [windows_path(line.strip(), file) for line in lines if line.strip() and not line.startswith("#")]


def read_roundtrip(directory):
    manifest = json.loads((directory / "fixture.json").read_text(encoding="utf-8"))
    if not re.fullmatch(r"Cuepoint-QA-[0-9a-f]{10}", manifest["playlist"]):
        raise ValueError("invalid fixture playlist name")
    outgoing = directory / (manifest["playlist"] + ".m3u8")
    incoming = directory / "rekordbox-reexport.m3u8"
    expected = [PureWindowsPath(track["path"]) for track in manifest["tracks"]]
    if len(expected) != 3 or len(set(expected)) != 3 or not all(path.is_absolute() for path in expected):
        raise ValueError("expected three distinct absolute audio paths")
    if entries(outgoing) != expected:
        raise ValueError("Cuepoint export differs from the fixture's expected order and paths")
    actual = entries(incoming)
    if actual != expected:
        raise ValueError(f"Rekordbox re-export differs from expected paths or order: {actual!r}")
    files = (outgoing, incoming, directory / "fixture.json", *(directory / name for name in (
        "01-cuepoint-set.png", "02-cuepoint-handover.png", "03-rekordbox-import-dialog.png",
        "04-rekordbox-imported-playlist.png",
    )))
    evidence = {}
    for file in files:
        if file.suffix == ".png":
            with file.open("rb") as stream:
                if stream.read(8) != b"\x89PNG\r\n\x1a\n" or file.stat().st_size < 100:
                    raise ValueError(f"missing or invalid screenshot: {file.name}")
        evidence[file.name] = sha256(file)
    if len({value for name, value in evidence.items() if name.endswith(".png")}) != 4:
        raise ValueError("all four evidence screenshots must be distinct")
    return {"schemaVersion": 1, "playlist": manifest["playlist"], "expectedPaths": list(map(str, expected)),
            "rekordboxPaths": list(map(str, actual)), "files": evidence}


def verify_roundtrip(directory):
    result = read_roundtrip(directory)
    manifest = json.loads((directory / "fixture.json").read_text(encoding="utf-8"))
    if sha256(directory / "master.db") != manifest["librarySha256"]:
        raise ValueError("Cuepoint fixture database changed")
    audio_dir = (directory / "Cuepoint Test Audio").resolve(strict=True)
    if audio_dir.parent != directory:
        raise ValueError("fixture audio directory escapes the evidence directory")
    for track in manifest["tracks"]:
        file = Path(track["path"]).resolve(strict=True)
        if file.parent != audio_dir or file.suffix.lower() != ".wav":
            raise ValueError("fixture track escapes the generated audio directory")
        if sha256(file) != track["sha256"]:
            raise ValueError(f"fixture audio changed: {track['title']}")
    (directory / "rekordbox-reimport-result.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
    )
    print(f"Verified native roundtrip evidence: {len(result['expectedPaths'])} tracks in original order")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["fixture", "verify"])
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    action = create_fixture if args.command == "fixture" else verify_roundtrip
    try:
        action(args.directory.resolve())
    except (OSError, ValueError) as error:
        parser.exit(1, f"Rekordbox roundtrip blocked: {error}\n")
