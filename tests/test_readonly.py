import hashlib
import mmap
import os
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fixtures import generate
from library import Library
from sources import DEFAULT_SOURCE


def fingerprint(directory, prefix):
    files = {}
    for path in directory.glob(f"{prefix}*"):
        stat = path.stat()
        digest = hashlib.sha256()
        if stat.st_size:
            with path.open("rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
                digest.update(data)
        files[path.name] = stat.st_size, stat.st_mtime_ns, digest.hexdigest()
    return files


def test_committed_wal_is_included_without_touching_source(tmp_path):
    source = tmp_path / "master.db"
    generate(source, 3)
    with closing(sqlite3.connect(source)) as writer:
        assert writer.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        writer.execute("UPDATE djmdContent SET BPM=13800, Title=? WHERE ID='1'", ("Committed",))
        writer.commit()
        writer.execute("UPDATE djmdContent SET Title=? WHERE ID='1'", ("Uncommitted",))
        before = fingerprint(tmp_path, source.name)
        library = Library.load(source)
        try:
            track = library.detail("1")
            assert track["title"] == "Committed"
            assert track["bpm"] == 138.00
        finally:
            library.close()
        assert fingerprint(tmp_path, source.name) == before


@pytest.mark.skipif(os.environ.get("CUEPOINT_VERIFY_REAL") != "1", reason="opt-in for the local production database")
def test_production_snapshot_leaves_master_and_sidecars_byte_identical():
    source = DEFAULT_SOURCE / "master.db"
    before = fingerprint(source.parent, source.name)
    library = Library.load(source)
    try:
        assert library.kind == "Master"
        assert library.total > 0
        print(f"Read-only master.db: {library.total:,} Tracks, {library.key_count:,} mit Camelot-Key")
    finally:
        library.close()
    assert fingerprint(source.parent, source.name) == before
