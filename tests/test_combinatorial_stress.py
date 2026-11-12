"""Validate query results against a Python oracle built from the fixture's raw SQL."""

import hashlib
import json
import mmap
import os
import random
import re
import shutil
import sqlite3
import sys
import unicodedata
from contextlib import closing
from functools import reduce
from itertools import product
from operator import and_
from pathlib import Path
from statistics import mean, quantiles
from time import perf_counter, thread_time

import pytest

from generate_synthetic_db import DEFAULT_PATH, generate

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from keys import camelot, compatible
from library import Library


QA_SEED = 61521
PERFORMANCE_TARGET_MS = 50
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
        self.all_tracks = (1 << len(self.ids)) - 1
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

        self._mask_cache = {}

    def mask(self, field, operation, value):
        cache_key = (field, operation, value)
        if cache_key in self._mask_cache:
            return self._mask_cache[cache_key]
        if field in TEXT_FIELDS and operation != "range":
            value = standard_text(value) or None
        elif field not in TEXT_FIELDS and field != "key" and operation not in ("empty", "range"):
            value = self.number(value)
            if value is None:
                return 0
        masks = self.groups[field]
        if operation == "eq":
            ans = masks.get(value, 0)
        elif operation == "empty":
            ans = masks.get(None, 0)
        elif operation == "neq":
            ans = self.all_tracks & ~masks.get(None, 0) & ~masks.get(value, 0)
        elif operation == "contains":
            ans = self.union(mask for entry, mask in masks.items() if entry and value in entry)
        elif operation == "range":
            parts = re.split(r"\.\.|;|,|\s+bis\s+|\s+[–—-]\s+", str(value).strip())
            bounds = [self.number(part) for part in parts]
            if len(bounds) != 2 or None in bounds:
                ans = 0
            else:
                low, high = sorted(bounds)
                ans = self.union(mask for entry, mask in masks.items() if entry is not None and low <= entry <= high)
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
    def number(value):
        try:
            converted = float(value)
        except (TypeError, ValueError, OverflowError):
            return None
        return converted if 0 <= converted <= 10**12 else None

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
        return self.expected_groups(filters, (), "AND", sorts)

    def expected_groups(self, filters, groups, logic, sorts):
        matching = reduce(and_, (self.mask(*rule) for rule in filters), self.all_tracks)
        group_masks = []
        for mode, rules in groups:
            active = [self.mask(field, op, value) for field, op, value in rules
                      if op == "empty" or (value is not None and str(value).strip())]
            if active:
                group_masks.append(self.union(active) if mode == "OR" else reduce(and_, active))
        if group_masks:
            matching &= self.union(group_masks) if logic == "OR" else reduce(and_, group_masks)
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
        "rules": rules_payload(filters),
        "sorts": [{"id": field, "desc": descending} for field, descending in sorts],
        **other,
    }


def rules_payload(rules):
    return [{"id": field, "op": op, "value": value} for field, op, value in rules]


def test_fixture_and_join_contract(library, reference, db_path):
    tracks = reference.raw
    artists = {row["artist"] for row in tracks if row["artist"]}
    assert len(tracks) >= 15_500
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
            expected = None if (field == "year" and track[field] is not None and track[field] <= 0) else track[field]
            assert result[field] == expected
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
    rng = random.Random(QA_SEED)
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


def nested_plans(reference, count):
    rng = random.Random(QA_SEED + 1)
    modes = list(product(("AND", "OR"), repeat=3))
    seen = set()
    for index in range(count):
        outer, left_mode, right_mode = modes[index % len(modes)]
        while True:
            pivot = rng.choice(reference.ids)
            fields = rng.sample(("title", "artist", "bpm", "seconds", "plays", "key", "path"), 4)
            rules = []
            for field in fields:
                value = reference.fields[field][pivot]
                rules.append((field, "empty" if value is None else "eq", value))
            if index % 7 == 0:
                rules[0] = ("bpm", "range", "138.01..137.99")
            elif index % 7 == 1:
                rules[0] = (rng.choice(("bpm", "year", "seconds", "artist", "genre")), "empty", None)
            groups = tuple(sorted(((left_mode, tuple(sorted(rules[:2], key=repr))),
                                   (right_mode, tuple(sorted(rules[2:], key=repr)))), key=repr))
            sorts = tuple((field, bool(rng.getrandbits(1))) for field in rng.sample(SORT_FIELDS, index % 4 + 1))
            signature = outer, groups, sorts
            if signature not in seen:
                seen.add(signature)
                yield signature
                break


def measured_query(library, request):
    cpu_started = thread_time()
    started = perf_counter()
    answer = library.query(request)
    elapsed = (perf_counter() - started) * 1000
    return answer, elapsed, (thread_time() - cpu_started) * 1000


def timing_summary(samples):
    if not samples:
        return {"count": 0}
    percentiles = quantiles(samples, n=100, method="inclusive") if len(samples) > 1 else samples * 99
    return {
        "count": len(samples),
        "meanMs": mean(samples),
        "p50Ms": percentiles[49],
        "p95Ms": percentiles[94],
        "p99Ms": percentiles[98],
        "maxMs": max(samples),
        "atOrAboveTarget": sum(value >= PERFORMANCE_TARGET_MS for value in samples),
    }


def test_combinatorial_stress(library, reference):
    size = int(os.getenv("CUEPOINT_QA_CASES", "100000"))
    assert size > 0
    assert len(reference.ids) >= 15_500
    nested_size = size // 4
    times = []
    cpu_times = []
    full_times = []
    nested_times = []
    zero_results = 0
    total_matches = 0
    verified = 0
    started = perf_counter()
    report = ROOT / "reports" / "combinatorial-metrics.json"
    flat = iter(plans(reference, size - nested_size))
    nested = iter(nested_plans(reference, nested_size))
    try:
        for index in range(1, size + 1):
            groups = ()
            logic = "AND"
            if index % 4 == 0:
                logic, groups, sorts = next(nested)
                filters = ()
            else:
                filters, sorts = next(flat)
            expected = reference.expected_groups(filters, groups, logic, sorts)
            request = payload(filters, sorts, facets=False, idsOnly=True)
            if groups:
                request.update(groups=[{"mode": mode, "rules": rules_payload(rules)} for mode, rules in groups],
                               groupLogic=logic)
            answer, elapsed, cpu_elapsed = measured_query(library, request)
            times.append(elapsed)
            cpu_times.append(cpu_elapsed)
            assert answer["rows"] == expected, f"Abfrage {index}: {request}"
            assert answer["counts"][-1] == len(expected)
            if index == 1 or index % 997 == 0:
                full_request = {**request, "facets": True, "idsOnly": False}
                full, full_elapsed, _ = measured_query(library, full_request)
                full_times.append(full_elapsed)
                assert [row["id"] for row in full["rows"]] == expected, f"Vollabfrage {index}: {full_request}"
                assert full["counts"][-1] == len(expected)
            verified += 1
            if groups:
                nested_times.append(elapsed)
            zero_results += not expected
            total_matches += len(expected)
            if index % 10_000 == 0:
                print(f"{index:,}/{size:,} Kombinationen | Ø {mean(times):.3f} ms | max {max(times):.3f} ms",
                      flush=True)
    finally:
        timings = timing_summary(times)
        data = {
            "schemaVersion": 1,
            "seed": QA_SEED,
            "nestedSeed": QA_SEED + 1,
            "tracks": len(reference.ids),
            "casesPlanned": size,
            "casesVerified": verified,
            "nestedCasesVerified": len(nested_times),
            "correctnessPassed": verified == size,
            "totalMatches": total_matches,
            "emptyResults": zero_results,
            "durationSeconds": perf_counter() - started,
            "performanceTargetMs": PERFORMANCE_TARGET_MS,
            "timings": timings,
            "nestedTimings": timing_summary(nested_times),
            "fullTimings": timing_summary(full_times),
            "threadCpuTimings": timing_summary(cpu_times),
        }
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(data, indent=2), flush=True)
