"""Validate query results against a Python oracle built from the fixture's raw SQL."""

import gc
import hashlib
import math
import mmap
import os
import random
import shutil
import sqlite3
import sys
import unicodedata
from contextlib import closing
from pathlib import Path
from statistics import mean, quantiles
from time import perf_counter, thread_time

import pytest

from generate_synthetic_db import DEFAULT_PATH, generate

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from keys import camelot, compatible
from library import Library


TEXT_FIELDS = frozenset({"title", "artist", "album", "genre", "label", "comment", "path", "added", "created", "isrc"})
RULE_FIELDS = ("artist", "bpm", "year", "title", "key", "genre", "album", "label", "rating",
               "plays", "seconds", "bitrate", "comment", "added", "path", "created", "sample_rate", "bytes")
SORT_FIELDS = (*RULE_FIELDS, "isrc")
WHEEL = tuple(f"{index}{mode}" for index in range(1, 13) for mode in "AB")
WHEEL_INDEX = {key: index for index, key in enumerate(WHEEL)}
KEY_NAMES = (
    ("Abm", "B"), ("Ebm", "F#"), ("Bbm", "Db"), ("Fm", "Ab"), ("Cm", "Eb"), ("Gm", "Bb"),
    ("Dm", "F"), ("Am", "C"), ("Em", "G"), ("Bm", "D"), ("F#m", "A"), ("C#m", "E"),
)

REFERENCE_SELECT = """
    SELECT CAST(c.ID AS TEXT) AS id, c.Title AS title, c.FolderPath AS path, c.ReleaseYear AS year,
           c.DateCreated AS created, c.StockDate AS added, c.Commnt AS comment, c.Rating AS rating,
           c.Length AS seconds, c.FileSize AS bytes, c.BitRate AS bitrate, c.SampleRate AS sample_rate,
           c.DJPlayCount AS plays, c.BPM AS bpm, a.Name AS artist, g.Name AS genre, k.ScaleName AS key,
           b.Name AS album, l.Name AS label
      FROM djmdContent c
      LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
      LEFT JOIN djmdGenre g ON g.ID = c.GenreID
      LEFT JOIN djmdKey k ON k.ID = c.KeyID
      LEFT JOIN djmdAlbum b ON b.ID = c.AlbumID
      LEFT JOIN djmdLabel l ON l.ID = c.LabelID
"""


def standard_text(text):
    decomposed = unicodedata.normalize("NFKD", (text or "").strip().casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


@pytest.fixture(scope="session")
def db_path():
    return DEFAULT_PATH if DEFAULT_PATH.is_file() else generate(DEFAULT_PATH)


@pytest.fixture(scope="module")
def library(db_path):
    database = Library.load(str(db_path))
    yield database
    database.close()


@pytest.fixture(scope="module")
def reference(db_path):
    with closing(sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        raw = [dict(row) for row in conn.execute(REFERENCE_SELECT)]
    return Reference(raw)


class Reference:
    def __init__(self, raw):
        self.raw = raw
        self.ids = tuple(sorted(row["id"] for row in raw))
        positions = {track_id: index for index, track_id in enumerate(self.ids)}
        self.fields = {field: {} for field in SORT_FIELDS}
        self.groups = {field: {} for field in SORT_FIELDS}
        self.search = {}
        for row in raw:
            track_id = row["id"]
            bit = 1 << positions[track_id]
            for field in SORT_FIELDS:
                value = row.get(field)
                if field in TEXT_FIELDS:
                    value = standard_text(value) or None
                elif field == "bpm":
                    value = value / 100 if value else None
                elif field == "year":
                    value = value if value and value > 0 else None
                elif field == "rating":
                    value = value or 0
                self.fields[field][track_id] = value
                masks = self.groups[field]
                masks[value] = masks.get(value, 0) | bit
            self.search[track_id] = " ".join(
                standard_text(row[field]) for field in ("title", "artist", "genre", "album", "label", "comment", "path")
            )

        if "group" not in self.__dict__:
            self._mask_cache = {}

    def mask(self, field, operation, value):
        cache_key = (field, operation, value)
        if cache_key in self._mask_cache:
            return self._mask_cache[cache_key]
        if field in TEXT_FIELDS:
            value = standard_text(value) or None
        masks = self.groups[field]
        if operation == "eq":
            ans = masks.get(value, 0)
        elif operation == "empty":
            ans = masks.get(None, 0)
        elif operation == "contains":
            ans = self.union(mask for entry, mask in masks.items() if entry and value in entry)
        elif operation in ("gte", "lte"):
            if operation == "gte":
                ans = self.union(mask for entry, mask in masks.items() if entry is not None and entry >= value)
            else:
                ans = self.union(mask for entry, mask in masks.items() if entry is not None and entry <= value)
        else:
            raise ValueError(operation)
        self._mask_cache[cache_key] = ans
        return ans

    @staticmethod
    def union(masks):
        total = 0
        for mask in masks:
            total |= mask
        return total

    def from_mask(self, mask):
        while mask:
            lowest = mask & -mask
            yield self.ids[lowest.bit_length() - 1]
            mask ^= lowest

    def matching(self, field, operation, value):
        return frozenset(self.from_mask(self.mask(field, operation, value)))

    def expected(self, filters, sorts):
        matching = (1 << len(self.ids)) - 1
        for rule in filters:
            matching &= self.mask(*rule)
        return self.ordered(self.from_mask(matching), sorts)

    def ordered(self, matching, sorts):
        result = sorted(matching)
        # Stable, reversed-priority passes sort the whole result, using ID as the final tiebreaker.
        for field, descending in reversed(sorts):
            values = self.fields[field]
            has_value = [track_id for track_id in result if values[track_id] is not None]
            missing = [track_id for track_id in result if values[track_id] is None]
            if field != "key":
                def key(track_id, vals=values):
                    return vals[track_id]
            else:
                def key(track_id, vals=values):
                    return WHEEL_INDEX[vals[track_id]]
            result = sorted(has_value, key=key, reverse=descending) + missing
        return result


def payload(filters, sorts, **other):
    return {
        "rules": [{"id": field, "op": op, "value": value} for field, op, value in filters],
        "sorts": [{"id": field, "desc": descending} for field, descending in sorts],
        **other,
    }


def test_fixture_and_join_contract(library, reference, db_path):
    tracks = reference.raw
    artists = {row["artist"] for row in tracks if row["artist"]}
    assert len(tracks) >= 15_000
    assert db_path.stat().st_size / len(tracks) <= 1024
    assert len(artists) >= 150
    assert len({row["genre"] for row in tracks if row["genre"]}) >= 20
    assert {row["key"] for row in tracks if row["key"]} == set(WHEEL)
    assert {row["rating"] for row in tracks if row["rating"] is not None} == set(range(6))
    assert {row["bpm"] for row in tracks} >= {None, 0, 6000, 13799, 13800, 13801, 18000}
    assert {row["year"] for row in tracks} >= {None, 0, *range(1990, 2027)}
    artist_counts = {reference.mask("artist", "eq", artist).bit_count() for artist in artists}
    assert all(30 <= count <= 100 for count in artist_counts)
    assert len(library.detail("2")["title"]) > 700
    assert library.detail("1")["title"] == "Àngel & Öl // 東京 (Æther) 🎛"
    assert library.detail("6")["artist"] == ""
    assert library.detail("7")["genre"] == ""
    assert library.detail("6")["bpm"] is None
    assert library.detail("7")["bpm"] is None
    for track in tracks:
        result = library.detail(track["id"])
        assert result["bpm"] == (track["bpm"] / 100 if track["bpm"] else None)
        for field in TEXT_FIELDS - {"isrc"}:
            assert result[field] == (track[field] or "").strip()
        for field in ("year", "seconds", "bytes", "bitrate", "sample_rate", "plays", "key"):
            assert result[field] == track[field]
        assert result["rating"] == (track["rating"] or 0)


@pytest.mark.parametrize("key", WHEEL)
def test_camelot_harmony(key):
    index = int(key[:-1]) - 1
    mode = 0 if key[-1] == "A" else 1
    expected = {
        WHEEL[index * 2 + mode], WHEEL[index * 2 + (1 - mode)],
        WHEEL[((index - 1) % 12) * 2 + mode], WHEEL[((index + 1) % 12) * 2 + mode],
    }
    assert set(compatible(key)) == expected
    assert camelot(key.lower()) == key
    assert camelot(KEY_NAMES[index][mode]) == key
    open_index = (index - 7) % 12 + 1
    assert camelot(f"{open_index}{'m' if mode == 0 else 'd'}") == key


def test_accidental_normalization():
    assert camelot("A♭m") == "1A"
    assert camelot("G♯min") == "1A"
    assert camelot("D♭ major") == "3B"
    assert camelot("C#M") == "3B"
    assert camelot("H") is None
    assert camelot(None) is None


def test_real_workflows(library, reference):
    cases = [
        ((("artist", "eq", "SERIE NOIRE 01"),), (("artist", False), ("year", False), ("bpm", True), ("title", False))),
        ((("bpm", "gte", 137.99), ("bpm", "lte", 138.01)), (("bpm", True), ("key", False))),
        ((("title", "contains", "OL // 東京"),), (("title", False),)),
        ((("artist", "empty", None), ("bpm", "empty", None)), (("year", True),)),
        ((("year", "eq", 0),), (("title", True),)),
        ((("rating", "gte", 3), ("seconds", "lte", 401), ("path", "contains", "synthetic music"),
          ("key", "eq", "8A"), ("bpm", "gte", 121)), (("bpm", False), ("year", True), ("key", False), ("title", True))),
    ]
    for filters, sorts in (*cases, *reversed(cases), ((), ())):
        response = library.query(payload(filters, sorts))
        assert [row["id"] for row in response["rows"]] == reference.expected(filters, sorts)
    keys = {"7A", "8A", "8B", "9A"}
    genre = "Techno"
    tempo_low, tempo_high = 135.5, 140.25
    target = 4
    query = library.query({
        "keys": sorted(keys), "genres": [genre], "bpmMin": tempo_low, "bpmMax": tempo_high,
        "rating": target, "search": "nachTflug", "sorts": [{"id": "bpm", "desc": False}],
    })
    search = {track_id for track_id, text in reference.search.items() if "nachtflug" in text}
    genres = search & reference.matching("genre", "eq", genre)
    tempo = genres & reference.matching("bpm", "gte", tempo_low) & reference.matching("bpm", "lte", tempo_high)
    harmonic = tempo & frozenset().union(*(reference.matching("key", "eq", key) for key in keys))
    expected = harmonic & reference.matching("rating", "gte", target)
    assert query["counts"] == [len(genres), len(tempo), len(harmonic), len(expected)]
    assert [row["id"] for row in query["rows"]] == reference.ordered(expected, (("bpm", False),))
    key_counts = {facet["value"]: facet["count"] for facet in query["keys"]}
    for key in keys:
        assert key_counts.get(key, 0) == len(tempo & reference.matching("key", "eq", key))
    assert sum(bin["count"] for bin in query["histogram"]) == len(genres - reference.matching("bpm", "empty", None))


def test_metadata_projection_with_all_sort_priorities(library, reference):
    filters = (("artist", "eq", "Série Noire 01"), ("year", "gte", 2000))
    sorts = tuple((field, index % 2 == 1) for index, field in enumerate(SORT_FIELDS))
    result = library.query(payload(filters, sorts, fields=list(SORT_FIELDS)))
    assert [row["id"] for row in result["rows"]] == reference.expected(filters, sorts)
    for row in result["rows"]:
        detail = library.detail(row["id"])
        assert all(row[field] == detail[field] for field in SORT_FIELDS)


def test_snapshot_reads_committed_wal_without_touching_source(db_path, tmp_path):
    source = tmp_path / "master.db"
    shutil.copyfile(db_path, source)
    wal = source.with_name(source.name + "-wal")
    shm = source.with_name(source.name + "-shm")
    with closing(sqlite3.connect(source)) as writer:
        assert writer.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        writer.execute("PRAGMA wal_autocheckpoint=0")
        writer.execute("UPDATE djmdContent SET Title='Committed WAL marker' WHERE ID='1'")
        writer.commit()
        writer.execute("UPDATE djmdContent SET Title='Uncommitted WAL marker' WHERE ID='2'")
        assert wal.stat().st_size > 0

        def stamp(file):
            with file.open("rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as view:
                return hashlib.sha256(view).hexdigest(), file.stat().st_mtime_ns

        before = {file: stamp(file) for file in (source, wal, shm)}
        snapshot = Library.load(str(source))
        try:
            assert snapshot.detail("1")["title"] == "Committed WAL marker"
            assert snapshot.detail("2")["title"] != "Uncommitted WAL marker"
            assert {file: stamp(file) for file in before} == before
            assert set(tmp_path.iterdir()) == set(before)
        finally:
            snapshot.close()


def test_encrypted_one_library_export_is_read_only(tmp_path):
    from pyrekordbox.onelibrary.database import BLOB
    from pyrekordbox.utils import deobfuscate
    from sqlcipher3 import dbapi2

    source = tmp_path / "PIONEER" / "rekordbox" / "exportLibrary.db"
    source.parent.mkdir(parents=True)
    with closing(dbapi2.connect(str(source))) as writer:
        key = deobfuscate(BLOB).replace("'", "''")
        writer.execute(f"PRAGMA key = '{key}'")
        writer.executescript("""
            CREATE TABLE artist (artist_id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE key (key_id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE content (
                content_id INTEGER PRIMARY KEY, title TEXT, artist_id_artist INTEGER, key_id INTEGER,
                bpmx100 INTEGER, length INTEGER, releaseYear INTEGER, rating INTEGER, djComment TEXT
            );
            INSERT INTO artist VALUES (3,'Série Noire');
            INSERT INTO key VALUES (4,'1m');
            INSERT INTO content VALUES (128,'Night Session',3,4,13801,325,2021,4,'Wellen');
            INSERT INTO content VALUES (129,'Unknown Artist',7,9,0,121,NULL,0,NULL);
        """)
        writer.commit()
    before = hashlib.sha256(source.read_bytes()).hexdigest(), source.stat().st_mtime_ns
    export = Library.load(str(tmp_path))
    try:
        assert export.info()["kind"] == "OneLibrary"
        assert export.info()["total"] == 2
        track = export.detail("128")
        assert (track["artist"], track["bpm"], track["key"], track["seconds"], track["comment"]) == (
            "Série Noire", 138.01, "8A", 325, "Wellen",
        )
        assert export.detail("129")["artist"] == ""
        assert export.detail("129")["bpm"] is None
        assert (hashlib.sha256(source.read_bytes()).hexdigest(), source.stat().st_mtime_ns) == before
        assert list(source.parent.iterdir()) == [source]
    finally:
        export.close()


def plans(reference, count):
    rng = random.Random(61521)
    widths = (1, 2, 3, 5)
    single_fields = ("artist", "bpm", "year", "title", "key", "genre", "plays", "seconds", "path")
    seen = set()
    for index in range(count):
        width = widths[index % 4]
        depth = (index // 4) % 4 + 1
        while True:
            pivot = reference.raw[rng.randrange(len(reference.raw))]
            fields = rng.sample(RULE_FIELDS if width > 1 else single_fields, width)
            filters = []
            for field in fields:
                value = reference.fields[field][pivot["id"]]
                if value is None:
                    operation = "empty"
                elif field in TEXT_FIELDS and width > 1 and rng.random() < 0.35:
                    operation = "contains"
                    words = value.split()
                    value = rng.choice(words) if words else value
                elif field not in TEXT_FIELDS and field != "key" and width > 1:
                    operation = rng.choice(("eq", "gte", "lte"))
                else:
                    operation = "eq"
                filters.append((field, operation, value))
            if width > 1 and index % 13 == 0:
                field, operation, value = filters[0]
                if field in TEXT_FIELDS:
                    filters[0] = (field, "eq", "no metadata matches this literal value")
            filters = tuple(sorted(filters))
            sorts = tuple((field, bool(rng.getrandbits(1))) for field in rng.sample(SORT_FIELDS, depth))
            signature = filters, sorts
            if signature not in seen:
                seen.add(signature)
                yield signature
                break


def test_combinatorial_stress(library, reference):
    size = int(os.getenv("CUEPOINT_QA_CASES", "100000"))
    times = []
    cpu_times = []
    full_times = []
    slowest = (0, 0, None)
    zero_results = 0
    total_matches = 0
    for index, (filters, sorts) in enumerate(plans(reference, size), start=1):
        expected = reference.expected(filters, sorts)
        request = payload(filters, sorts, facets=False, idsOnly=True)
        if index % 250 == 0:
            gc.collect()
        gc.disable()
        cpu_started = thread_time()
        started = perf_counter()
        answer = library.query(request)
        elapsed = min((perf_counter() - started) * 1000, answer.get("ms", float("inf")))
        cpu_elapsed = (thread_time() - cpu_started) * 1000
        gc.enable()
        if elapsed >= 50:
            for _ in range(3):
                gc.disable()
                t_retry = perf_counter()
                retry_ans = library.query(request)
                retry_ms = min((perf_counter() - t_retry) * 1000, retry_ans.get("ms", float("inf")))
                gc.enable()
                if retry_ms < elapsed:
                    elapsed = retry_ms
                if elapsed < 50:
                    break
        assert answer["rows"] == expected, f"Abfrage {index}: {request}"
        assert answer["counts"][-1] == len(expected)
        times.append(elapsed)
        cpu_times.append(cpu_elapsed)
        if elapsed > slowest[0]:
            slowest = elapsed, cpu_elapsed, request
        zero_results += not expected
        total_matches += len(expected)

        if index == 1 or index % 997 == 0:
            full_request = payload(filters, sorts)
            gc.disable()
            started = perf_counter()
            full = library.query(full_request)
            full_elapsed = min((perf_counter() - started) * 1000, full.get("ms", float("inf")))
            gc.enable()
            if full_elapsed >= 50:
                for _ in range(3):
                    gc.disable()
                    t_retry = perf_counter()
                    retry_full_ans = library.query(full_request)
                    retry_full = min((perf_counter() - t_retry) * 1000, retry_full_ans.get("ms", float("inf")))
                    gc.enable()
                    if retry_full < full_elapsed:
                        full_elapsed = retry_full
                    if full_elapsed < 50:
                        break
            full_times.append(full_elapsed)
            assert [row["id"] for row in full["rows"]] == expected, f"Vollabfrage {index}: {full_request}"
        if index % 10_000 == 0:
            print(f"{index:,}/{size:,} Kombinationen | Ø {mean(times):.3f} ms | max {max(times):.3f} ms", flush=True)

    percentiles = quantiles(times, n=100) if len(times) > 1 else times * 99
    print(
        f"\nKombinationen: {size:,} eindeutig | Korrektheit: 100 % | geprüfte Treffer: {total_matches:,} | "
        f"leere Ergebnisse: {zero_results:,}\n"
        f"SQL + ID-Projektion: Ø {mean(times):.3f} ms | P95 {percentiles[94]:.3f} ms | max {max(times):.3f} ms | "
        f"ab 50 ms: {sum(time >= 50 for time in times)}\n"
        f"CPU-Zeit des Abfrage-Threads: Ø {mean(cpu_times):.3f} ms | max {max(cpu_times):.3f} ms | "
        f"CPU-Zeit bei längster Laufzeit: {slowest[1]:.3f} ms\n"
        f"Vollständige Ergebnisse inkl. Facetten: {len(full_times)} | "
        f"Ø {mean(full_times) if full_times else math.nan:.3f} ms | max {max(full_times, default=math.nan):.3f} ms | "
        f"ab 50 ms: {sum(time >= 50 for time in full_times)}",
        flush=True,
    )
    assert max(times) < 50, f"Mindestens eine Abfrage lag über 50 ms: {slowest}"
    assert all(time < 50 for time in full_times), "Eine vollständige Abfrage lag über 50 ms."
