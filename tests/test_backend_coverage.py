import io
import json
import math
import numpy as np
import runpy
import sqlite3
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import fixtures
import keys
import library as lib_mod
import live as live_mod
import main as main_mod
import rekordbox_live as rb_live
import sources


# ---------------------------------------------------------------------------
# 1. keys.py — 100% Zweige
# ---------------------------------------------------------------------------

def test_keys_all_notations_and_empty_compatible():
    assert keys.camelot("8A") == "8A"
    assert keys.camelot("1m") == "8A"
    assert keys.camelot("1d") == "8B"
    assert keys.camelot("F# minor") == "11A"
    assert keys.camelot("A♯ major") == "6B"
    assert keys.camelot("C moll") == "5A"
    assert keys.camelot("INVALID-KEY") is None
    assert keys.camelot(None) is None
    assert keys.compatible("") == {}
    assert keys.compatible(None) == {}
    assert keys.compatible("12A") == {
        "12A": "Gleiche Tonart",
        "12B": "Paralleltonart",
        "11A": "Camelot −1",
        "1A": "Camelot +1",
    }


# ---------------------------------------------------------------------------
# 2. fixtures.py — Generator & CLI __main__
# ---------------------------------------------------------------------------

def test_fixtures_cli_and_positive_check(tmp_path, monkeypatch):
    out = tmp_path / "mini.db"
    monkeypatch.setattr(sys, "argv", ["fixtures.py", str(out), "--tracks", "20"])
    runpy.run_path(str(ROOT / "backend" / "fixtures.py"), run_name="__main__")
    assert out.exists()

    with sqlite3.connect(out) as conn:
        assert conn.execute("SELECT count(*) FROM djmdContent").fetchone()[0] == 20

    bad = tmp_path / "bad.db"
    monkeypatch.setattr(sys, "argv", ["fixtures.py", str(bad), "--tracks", "0"])
    with pytest.raises(SystemExit):
        runpy.run_path(str(ROOT / "backend" / "fixtures.py"), run_name="__main__")


# ---------------------------------------------------------------------------
# 3. sources.py — resolve, snapshot retry, SQLite/SQLCipher, OneLibrary, .pdb, USB
# ---------------------------------------------------------------------------

def test_sources_resolve_snapshot_sqlite_onelibrary_and_legacy(tmp_path, monkeypatch):
    # resolve_source errors & directory discovery
    with pytest.raises(ValueError):
        sources.resolve_source(tmp_path / "does_not_exist")

    nested = tmp_path / "PIONEER" / "Master"
    nested.mkdir(parents=True)
    db_file = nested / "master.db"
    fixtures.generate(db_file, 10)
    assert sources.resolve_source(tmp_path) == db_file.resolve()
    assert sources.resolve_source(db_file) == db_file.resolve()

    # _stamp FileNotFoundError & snapshot missing / retry failure
    assert sources._stamp(tmp_path / "missing.db") is None
    with pytest.raises(ValueError, match="nicht lesbar"):
        with sources.snapshot(tmp_path / "missing.db"):
            pass

    monkeypatch.setattr(sources.time, "sleep", lambda *_: None)
    seq = iter([(1, 1, 1, 1, 1), (2, 2, 2, 2, 2)] * 3)
    real_stamp = sources._stamp
    monkeypatch.setattr(sources, "_stamp", lambda p: next(seq) if p == db_file else real_stamp(p))
    with pytest.raises(ValueError, match="Rekordbox schreibt gerade"):
        with sources.snapshot(db_file):
            pass
    monkeypatch.setattr(sources, "_stamp", real_stamp)

    # Read Master & OneLibrary schemas
    kind, rows = sources.read_source(db_file)
    assert kind == "Master" and len(rows) == 10

    one_db = tmp_path / "exportLibrary.db"
    with sqlite3.connect(one_db) as conn:
        conn.executescript("""
            CREATE TABLE artist (artist_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE genre (genre_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE key (key_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE album (album_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE label (label_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE content (
                content_id TEXT PRIMARY KEY, title TEXT, path TEXT, releaseYear INTEGER,
                dateCreated TEXT, dateAdded TEXT, djComment TEXT, rating INTEGER,
                length INTEGER, fileSize INTEGER, bitrate INTEGER, samplingRate INTEGER,
                djPlayCount INTEGER, bpmx100 INTEGER, analysisDataFilePath TEXT, isrc TEXT,
                masterContentId TEXT, artist_id_artist TEXT, genre_id TEXT, key_id TEXT,
                album_id TEXT, label_id TEXT
            );
            INSERT INTO artist VALUES ('a1', 'Artist 1');
            INSERT INTO genre VALUES ('g1', 'Techno');
            INSERT INTO key VALUES ('k1', '8A');
            INSERT INTO content VALUES ('c1', 'Track One', '/m/1.mp3', 2024, '2024-01-01', '2024-02-01',
                'Nice', 5, 300, 1000, 320, 44100, 2, 13800, '/a/1.DAT', 'ISRC1', 'orig1', 'a1', 'g1', 'k1', NULL, NULL);
        """)
    kind, rows = sources.read_source(one_db)
    assert kind == "OneLibrary" and rows[0]["bpm"] == 138.0 and rows[0]["artist"] == "Artist 1"

    # Unsupported schema raises ValueError
    unknown_db = tmp_path / "unknown.db"
    with sqlite3.connect(unknown_db) as conn:
        conn.execute("CREATE TABLE other (x INTEGER)")
    with pytest.raises(ValueError, match="unterstützten Rekordbox"):
        sources.read_source(unknown_db)

    # Encrypted SQLCipher path (mock sqlcipher3 trying keys and failing)
    enc_db = tmp_path / "encrypted.db"
    enc_db.write_bytes(b"NotSQLiteHeader!" + b"\x00" * 64)

    class FakeDatabaseError(Exception):
        pass

    class FakeSqlcipherConn:
        def __init__(self, succeed_second=False):
            self.calls = 0
            self.succeed_second = succeed_second

        def execute(self, sql):
            self.calls += 1
            if "SELECT count" in sql and not self.succeed_second:
                raise FakeDatabaseError("bad key")
            return SimpleNamespace(fetchone=lambda: (0,))

        def close(self):
            pass

    fake_dbapi = types.ModuleType("sqlcipher3.dbapi2")
    fake_dbapi.DatabaseError = FakeDatabaseError
    attempt_counter = {"n": 0}

    def fake_connect(*_args, **_kwargs):
        attempt_counter["n"] += 1
        return FakeSqlcipherConn(succeed_second=(attempt_counter["n"] == 2))

    fake_dbapi.connect = fake_connect
    fake_pkg = types.ModuleType("sqlcipher3")
    fake_pkg.dbapi2 = fake_dbapi
    monkeypatch.setitem(sys.modules, "sqlcipher3", fake_pkg)
    monkeypatch.setitem(sys.modules, "sqlcipher3.dbapi2", fake_dbapi)
    conn_ok = sources._read_sqlite(enc_db)
    assert isinstance(conn_ok, FakeSqlcipherConn)

    fake_dbapi.connect = lambda *_a, **_k: FakeSqlcipherConn(succeed_second=False)
    with pytest.raises(ValueError, match="entschlüsselt"):
        sources._read_sqlite(enc_db)

    # Legacy .pdb Device Library path with mock rekordbox_pdb
    pdb_file = tmp_path / "export.pdb"
    pdb_file.write_bytes(b"PDBDUMMY")
    fake_pdb_mod = types.ModuleType("rekordbox_pdb")

    class FakePdb:
        artists = [SimpleNamespace(id=1, name="Legacy Artist")]
        genres = [SimpleNamespace(id=2, name="House")]
        albums = [SimpleNamespace(id=3, name="Legacy Album")]
        labels = [SimpleNamespace(id=4, name="Legacy Label")]
        keys = [SimpleNamespace(id=5, name="9A")]
        tracks = [SimpleNamespace(
            id=10, title="Legacy Track", file_path="/usb/track.mp3", year=2020,
            release_date="2020-01-01", date_added="2020-02-01", comment="USB",
            rating=4, duration=240, file_size=5000, bitrate=320, sample_rate=44100,
            play_count=3, analyze_path="/anlz/10.DAT", tempo=12600,
            artist_id=1, genre_id=2, album_id=3, label_id=4, key_id=5,
        )]

        @classmethod
        def from_file(cls, _path):
            return cls()

    fake_pdb_mod.Database = FakePdb
    monkeypatch.setitem(sys.modules, "rekordbox_pdb", fake_pdb_mod)
    kind, rows = sources.read_source(pdb_file)
    assert kind == "Device Library" and rows[0]["bpm"] == 126.0 and rows[0]["key_raw"] == "9A"

    # usb_sources on non-Windows branch & Windows mock
    with monkeypatch.context() as m:
        if hasattr(sources, "ctypes") and hasattr(sources.ctypes, "windll"):
            m.setattr(sources.ctypes.windll.kernel32, "GetDriveTypeW", lambda _: 1)
        usbs = sources.usb_sources()
        assert isinstance(usbs, list)
    with monkeypatch.context() as m:
        m.setattr(sources, "os", SimpleNamespace(name="posix"))
        assert sources.usb_sources() == []


# ---------------------------------------------------------------------------
# 4. library.py — Empty library, all _rule / _apply_rule operators, sort, project, match_media, waveform
# ---------------------------------------------------------------------------

def test_library_all_rule_branches_ranges_sorts_projections_and_waveform(tmp_path, monkeypatch):
    # Empty library
    empty = lib_mod.Library(None, "Demo", [])
    try:
        res = empty.query({})
        assert res["rows"] == [] and res["counts"] == [0, 0, 0, 0]
    finally:
        empty.close()

    assert lib_mod._parse_range("invalid") is None
    assert lib_mod._parse_range("120..abc") is None
    assert lib_mod._parse_range("140..130") == (130.0, 140.0)

    sample = [
        {"id": "1", "title": "Alpha", "artist": "Klara", "genre": "Techno", "bpm": 135.0,
         "key_raw": "8A", "rating": 5, "year": 2022, "seconds": 300, "plays": 2,
         "path": "/music/a.mp3", "analysis": "/anlz/1.DAT", "original_id": "orig1"},
        {"id": "2", "title": "Beta", "artist": "Mika", "genre": "House", "bpm": 124.0,
         "key_raw": "9B", "rating": 3, "year": 2019, "seconds": 250, "plays": 10,
         "path": "/music/b.mp3", "analysis": ""},
        {"id": "3", "title": "", "artist": "", "genre": "", "bpm": None,
         "key_raw": "", "rating": 0, "year": None, "seconds": None, "plays": None,
         "path": "", "analysis": ""},
    ]
    lib = lib_mod.Library(tmp_path / "master.db", "Master", sample)
    try:
        # Invalid rules/sorts ignored gracefully
        lib.query({
            "rules": [
                "bad",
                {"id": "nonexistent", "op": "eq", "value": "1"},
                {"id": "title", "op": "unknown_op", "value": "x"},
            ]
        })

        # contains all-match vs no-match vs numeric instr
        r_title = lib.query({"rules": [{"id": "title", "op": "contains", "value": "a"}], "fields": ["album"]})
        assert [r["id"] for r in r_title["rows"]] == ["1", "2"]
        assert lib.query({"rules": [{"id": "title", "op": "contains", "value": "zzz_none"}]})["rows"] == []
        r_path = lib.query({"rules": [{"id": "path", "op": "contains", "value": "a.mp3"}]})
        assert [r["id"] for r in r_path["rows"]] == ["1"]
        r_bpm = lib.query({"rules": [{"id": "bpm", "op": "contains", "value": "135"}]})
        assert [r["id"] for r in r_bpm["rows"]] == ["1"]
        assert lib.query({"rules": [{"id": "bpm", "op": "contains", "value": "999"}]})["rows"] == []

        # Text comparisons eq/neq/gte/gt/lte/lt including empty value
        assert {r["id"] for r in lib.query({"rules": [{"id": "title", "op": "eq", "value": ""}]})["rows"]} == {"3"}
        assert {
            r["id"] for r in lib.query({"rules": [{"id": "title", "op": "neq", "value": ""}]})["rows"]
        } == {"1", "2"}
        assert {
            r["id"] for r in lib.query({"rules": [{"id": "title", "op": "eq", "value": "Missing"}]})["rows"]
        } == set()
        assert {
            r["id"] for r in lib.query({"rules": [{"id": "title", "op": "neq", "value": "Missing"}]})["rows"]
        } == {"1", "2"}
        assert {r["id"] for r in lib.query({"rules": [{"id": "title", "op": "gte", "value": "B"}]})["rows"]} == {"2"}
        assert {r["id"] for r in lib.query({"rules": [{"id": "title", "op": "lt", "value": "B"}]})["rows"]} == {"1"}

        # Text/Key/ID range & empty rules
        assert {r["id"] for r in lib.query({"rules": [{"id": "year", "op": "empty", "value": ""}]})["rows"]} == {"3"}
        assert {r["id"] for r in lib.query({"rules": [{"id": "title", "op": "empty", "value": ""}]})["rows"]} == {"3"}
        assert {r["id"] for r in lib.query({"rules": [{"id": "key", "op": "empty", "value": ""}]})["rows"]} == {"3"}
        assert lib.query({"rules": [{"id": "id", "op": "empty", "value": ""}]})["rows"] == []
        assert {
            r["id"] for r in lib.query({"rules": [{"id": "key", "op": "range", "value": "10A..8A"}]})["rows"]
        } == {"1", "2"}
        assert lib.query({"rules": [{"id": "key", "op": "range", "value": "bad..key"}]})["rows"] == []
        assert {
            r["id"] for r in lib.query({"rules": [{"id": "id", "op": "range", "value": "2..1"}]})["rows"]
        } == {"1", "2"}
        assert {
            r["id"] for r in lib.query({"rules": [{"id": "title", "op": "range", "value": "Z..A"}]})["rows"]
        } == {"1", "2"}
        assert lib.query({"rules": [{"id": "title", "op": "range", "value": "onlyone"}]})["rows"] == []
        assert lib.query({"rules": [{"id": "bpm", "op": "range", "value": "bad"}]})["rows"] == []

        # Key & ID operators
        assert [r["id"] for r in lib.query({"rules": [{"id": "key", "op": "eq", "value": "8A"}]})["rows"]] == ["1"]
        assert lib.query({"rules": [{"id": "key", "op": "eq", "value": "BAD"}]})["rows"] == []
        id_ops = (
            ("eq", {"2"}),
            ("neq", {"1", "3"}),
            ("gte", {"2", "3"}),
            ("gt", {"3"}),
            ("lte", {"1", "2"}),
            ("lt", {"1"}),
        )
        for op, expected in id_ops:
            assert {r["id"] for r in lib.query({"rules": [{"id": "id", "op": op, "value": "2"}]})["rows"]} == expected
        assert lib.query({"rules": [{"id": "id", "op": "eq", "value": "999"}]})["rows"] == []
        assert lib.query({"rules": [{"id": "bpm", "op": "eq", "value": "not-a-num"}]})["rows"] == []

        # Legacy sort param, id sort, multi-sort + excludeId + idsOnly + unknown genre/keys
        assert [r["id"] for r in lib.query({"sort": "id", "desc": True, "excludeId": "3"})["rows"]] == ["2", "1"]
        assert lib.query({"sorts": ["bad", {"id": "unknown"}], "idsOnly": True})["rows"] == ["1", "2", "3"]
        multi_sorts = [{"id": "artist", "desc": False}, {"id": "id", "desc": True}]
        assert [r["id"] for r in lib.query({"sorts": multi_sorts})["rows"]] == ["1", "2", "3"]
        assert lib.query({"genres": ["Nonexistent"]})["rows"] == []
        assert {r["id"] for r in lib.query({"keys": ["", "8A"]})["rows"]} == {"1", "3"}
        assert lib.query({"search": "Techno", "fields": ["comment", "label"]})["rows"][0]["id"] == "1"

        # Invalid groups ignored & non-empty search/projection cache invalidation
        bad_groups = ["bad", {"mode": "AND", "rules": [{"id": "title", "op": "eq", "value": "  "}]}]
        assert len(lib.query({"groups": bad_groups})["rows"]) == 3

        # Groups (AND/OR modes + groupLogic AND/OR), numeric range, empty text cmp, projection cache hit
        bpm_rng = lib.query({"rules": [{"id": "bpm", "op": "range", "value": "120..136"}]})
        assert [r["id"] for r in bpm_rng["rows"]] == ["1", "2"]
        bpm_exact = lib.query({"rules": [{"id": "bpm", "op": "range", "value": "124..135"}]})
        assert [r["id"] for r in bpm_exact["rows"]] == ["1", "2"]
        key_exact = lib.query({"rules": [{"id": "key", "op": "range", "value": "8A..9B"}]})
        assert [r["id"] for r in key_exact["rows"]] == ["1", "2"]
        title_rng = lib.query({"rules": [{"id": "title", "op": "range", "value": "A..Z"}]})
        assert {r["id"] for r in title_rng["rows"]} == {"1", "2"}
        assert len(lib.query({"rules": [{"id": "title", "op": "gte", "value": ""}]})["rows"]) == 3
        assert [r["id"] for r in lib.query({"rules": [{"id": "title", "op": "eq", "value": "Alpha"}]})["rows"]] == ["1"]
        title_neq = lib.query({"rules": [{"id": "title", "op": "neq", "value": "Alpha"}]})
        assert {r["id"] for r in title_neq["rows"]} == {"2"}
        assert len(lib.query({"rules": [{"id": "id", "op": "neq", "value": "999"}]})["rows"]) == 3
        assert [r["id"] for r in lib.query({"rules": [{"id": "bpm", "op": "gte", "value": "130"}]})["rows"]] == ["1"]

        # Repeated projection with same fields exercises _project cache hit
        p1 = lib.query({"fields": ["album"]})
        p2 = lib.query({"fields": ["album"], "excludeId": "missing_id"})
        assert len(p1["rows"]) == len(p2["rows"]) == 3

        # select_many single/multi genre, non-string ignored, unknown key, numeric bounds, empty facet mask
        assert [r["id"] for r in lib.query({"genres": ["Techno"]})["rows"]] == ["1"]
        assert {r["id"] for r in lib.query({"genres": ["Techno", "House"]})["rows"]} == {"1", "2"}
        assert len(lib.query({"genres": [123]})["rows"]) == 3
        assert lib.query({"keys": ["BAD_KEY"]})["rows"] == []
        bounded = lib.query({
            "bpmMin": 125, "bpmMax": 140, "rating": 4,
            "yearMin": 2020, "yearMax": 2025, "plays": 1,
        })
        assert [r["id"] for r in bounded["rows"]] == ["1"]
        empty_res = lib.query({"rules": [{"id": "bpm", "op": "gte", "value": "500"}], "facets": True})
        assert empty_res["rows"] == [] and empty_res["genres"] == [] and empty_res["histogram"] == []
        assert lib.query({"bpmMin": 500, "facets": True})["keys"] == []

        grp_and_or = lib.query({
            "groupLogic": "OR",
            "groups": [
                {
                    "mode": "AND",
                    "rules": [
                        {"id": "bpm", "op": "eq", "value": "999"},
                        {"id": "title", "op": "eq", "value": "Alpha"},
                    ],
                },
                {
                    "mode": "OR",
                    "rules": [
                        {"id": "bpm", "op": "eq", "value": "999"},
                        {"id": "title", "op": "eq", "value": "Beta"},
                    ],
                },
            ],
        })
        assert [r["id"] for r in grp_and_or["rows"]] == ["2"]
        grp_and = lib.query({
            "groupLogic": "AND",
            "groups": [
                {"mode": "AND", "rules": [{"id": "bpm", "op": "gte", "value": "120"}]},
                {"mode": "OR", "rules": [{"id": "genre", "op": "eq", "value": "Techno"}]},
            ],
        })
        assert [r["id"] for r in grp_and["rows"]] == ["1"]

        # match_media paths
        assert lib.match_media(None) is None
        m1 = lib.match_media({"id": "9", "title": "Alpha", "artist": "Klara", "path": "/usb/a.mp3", "seconds": 300})
        assert m1["id"] == "1"
        m2 = lib.match_media({"id": "9", "title": "Other", "artist": "Other", "path": "/usb/a.mp3", "seconds": 300})
        assert m2["id"] == "1"
        m3 = lib.match_media({"id": "9", "title": "Beta", "artist": "Mika", "path": "/usb/a.mp3", "seconds": 300})
        assert m3 is None
        m4 = lib.match_media({
            "id": "9",
            "title": "Alpha",
            "artist": "Klara",
            "path": "/usb/other.mp3",
            "seconds": 301,
            "original_id": "1",
        })
        assert m4["id"] == "1"
        m5 = lib.match_media({
            "id": "9",
            "title": "Other",
            "artist": "Other",
            "path": "/usb/other.mp3",
            "seconds": 999,
            "original_id": "1",
        })
        assert m5 is None

        # recommendations empty & harmonic off
        assert lib.recommendations(None, "8A", None, 4, True) == []
        assert len(lib.recommendations(135, None, None, 20, False)) == 2
    finally:
        lib.close()

    # waveform branches (no path, parse success, error)
    no_path_lib = lib_mod.Library(None, "Demo", sample)
    assert lib_mod.waveform(no_path_lib, sample[0]) == []
    no_path_lib.close()

    anlz_dir = tmp_path / "anlz"
    anlz_dir.mkdir()
    anlz_file = anlz_dir / "1.DAT"
    anlz_file.write_bytes(b"DUMMY")
    wlib = lib_mod.Library(tmp_path / "master.db", "Master", sample)
    fake_anlz_mod = types.ModuleType("pyrekordbox.anlz")
    fake_anlz_mod.AnlzFile = SimpleNamespace(parse_file=lambda _p: {"PWAV": ([5, 12, 31],)})
    monkeypatch.setitem(sys.modules, "pyrekordbox.anlz", fake_anlz_mod)
    assert lib_mod.waveform(wlib, sample[0]) == [5, 12, 31]

    fake_anlz_mod.AnlzFile = SimpleNamespace(parse_file=lambda _p: (_ for _ in ()).throw(KeyError("no PWAV")))
    assert lib_mod.waveform(wlib, sample[0]) == []
    wlib.close()


# ---------------------------------------------------------------------------
# 5. live.py — _listener, DjLink.start errors, _run packet loop & announcements
# ---------------------------------------------------------------------------

def test_live_djlink_paths_and_loopback(monkeypatch):
    # _listener failure closes socket & re-raises
    class BadSocket:
        def setsockopt(self, *_a):
            pass

        def bind(self, *_a):
            raise OSError("port in use")

        def close(self):
            self.closed = True

    monkeypatch.setattr(live_mod.socket, "socket", lambda *_a: BadSocket())
    with pytest.raises(OSError):
        live_mod._listener("127.0.0.1", 50002)

    dl = live_mod.DjLink()
    monkeypatch.setattr(live_mod, "interfaces", lambda: [])
    with pytest.raises(ValueError, match="nicht mehr verfügbar"):
        dl.start("192.168.1.99", False)

    # _listener failure inside DjLink.start closes previously opened listeners
    first_sock = SimpleNamespace(closed=False, close=lambda: None, setsockopt=lambda *a: None)
    calls = {"n": 0}

    def fake_listener(_ip, port):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("busy")
        return first_sock

    monkeypatch.setattr(live_mod, "_listener", fake_listener)
    monkeypatch.setattr(
        live_mod,
        "interfaces",
        lambda: [{
            "name": "LAN",
            "ip": "10.0.0.2",
            "mac": "aa:bb:cc:dd:ee:ff",
            "broadcast": "10.0.0.255",
            "network": live_mod.ipaddress.IPv4Network("10.0.0.0/24"),
        }],
    )
    with pytest.raises(ValueError, match="UDP-Port"):
        dl.start("10.0.0.2", True)

    # Direct _run execution with fake listeners testing status packet, keepalive packet, announce & OSError
    pkt = bytearray(0xA4)
    pkt[0:11] = live_mod.MAGIC + b"\x0a"
    pkt[0x0B:0x10] = b"CDJ-3"
    pkt[0x21] = 2
    pkt[0x24] = 2
    pkt[0x28] = 2
    pkt[0x29] = 3
    pkt[0x2A] = 1
    pkt[0x2C:0x30] = (99).to_bytes(4, "big")
    pkt[0x89] = 0x60
    pkt[0x8C:0x90] = (0x100000).to_bytes(4, "big")
    pkt[0x92:0x94] = (12800).to_bytes(2, "big")

    keep = bytearray(54)
    keep[0:11] = live_mod.MAGIC + b"\x06"
    keep[0x24] = 1

    sent = []

    class FakeSock:
        def __init__(self, incoming):
            self.incoming = list(incoming)
            self.closed = False

        def recvfrom(self, _n):
            return self.incoming.pop(0)

        def sendto(self, data, addr):
            sent.append((data, addr))

        def close(self):
            self.closed = True

    iface = {"name": "LAN", "ip": "10.0.0.2", "mac": "aa:bb:cc:dd:ee:ff",
             "broadcast": "10.0.0.255", "network": live_mod.ipaddress.IPv4Network("10.0.0.0/24")}
    s_status = FakeSock([(bytes(pkt), ("10.0.0.10", 50002)), (bytes(pkt), ("192.168.99.9", 50002))])
    s_keep = FakeSock([(bytes(keep), ("10.0.0.10", 50000))])

    step = {"n": 0}

    def fake_select(listeners, *_a):
        step["n"] += 1
        if step["n"] == 1:
            return [listeners[1], listeners[0]], [], []
        if step["n"] == 2:
            # Force discovery branch -> then stop
            dl._stop.set()
            return [listeners[0]], [], []
        return [], [], []

    ticks = iter([100.0, 100.1, 103.0, 103.1])
    monkeypatch.setattr(live_mod.time, "monotonic", lambda: next(ticks, 105.0))
    monkeypatch.setattr(live_mod.select, "select", fake_select)
    dl._stop.clear()
    dl._run([s_status, s_keep], iface)
    assert sent and s_status.closed and s_keep.closed

    # Exhausted virtual player numbers branch
    dl2 = live_mod.DjLink()
    dl2._devices = {n: 103.0 for n in range(7, 16)}
    s1 = FakeSock([])
    s2 = FakeSock([])

    def stop_on_second(listeners, *_a):
        dl2._stop.set()
        return [], [], []

    ticks2 = iter([100.0, 103.0])
    monkeypatch.setattr(live_mod.time, "monotonic", lambda: next(ticks2, 105.0))
    monkeypatch.setattr(live_mod.select, "select", stop_on_second)
    dl2._run([s1, s2], iface)
    assert dl2.error and "belegt" in dl2.error

    # OSError inside _run sets error state
    def boom_select(*_a):
        raise OSError("socket failed")

    monkeypatch.setattr(live_mod.select, "select", boom_select)
    dl2._stop.clear()
    dl2._run([FakeSock([])], iface)
    assert dl2.state == "error"


# ---------------------------------------------------------------------------
# 6. rekordbox_live.py — Fader, Crossfader, Master, UIA discovery, _run
# ---------------------------------------------------------------------------

def test_rekordbox_live_faders_crossfader_master_and_discover(monkeypatch):
    # Crossfader & combine_fader_levels math
    assert rb_live.combine_fader_levels(None, None, 1, 2) is None
    assert rb_live.combine_fader_levels(0.8, None, 1, 2) == 0.8
    # Crossfader hard left (0.0) -> Deck 1 is 1.0, Deck 2 is 0.0
    assert rb_live.combine_fader_levels(1.0, 0.0, 1, 2) == 1.0
    assert rb_live.combine_fader_levels(1.0, 0.0, 2, 2) == 0.0
    # Crossfader center (0.5) -> both full gain
    assert rb_live.combine_fader_levels(0.6, 0.5, 1, 2) == 0.6
    assert rb_live.combine_fader_levels(0.9, 0.5, 2, 2) == 0.9
    # Crossfader hard right (1.0) -> Deck 1 is 0.0, Deck 2 is 1.0
    assert rb_live.combine_fader_levels(1.0, 1.0, 1, 2) == 0.0
    assert rb_live.combine_fader_levels(1.0, 1.0, 2, 2) == 1.0

    # _tempo, _position, _nearest helpers
    assert rb_live._tempo("bad") is None
    assert rb_live._tempo("128,5") == 128.5
    assert rb_live._position("bad", ".0") is None
    assert rb_live._nearest(rb_live.Display(None, "", "", 0, 0), []) is None

    # Fake UIA objects to test _normalized_slider, _is_master_active, _discover, RekordboxPlayback._run
    fake_uia = SimpleNamespace(
        UIA_NamePropertyId=1,
        UIA_HelpTextPropertyId=2,
        UIA_ControlTypePropertyId=3,
        UIA_BoundingRectanglePropertyId=4,
        UIA_RangeValueValuePropertyId=5,
        UIA_RangeValueMinimumPropertyId=6,
        UIA_RangeValueMaximumPropertyId=7,
        UIA_ToggleToggleStatePropertyId=8,
        UIA_ValueValuePropertyId=9,
        UIA_TextControlTypeId=10,
        UIA_EditControlTypeId=11,
        UIA_SliderControlTypeId=12,
        UIA_ButtonControlTypeId=13,
        TreeScope_Descendants=4,
    )

    class FakeEl:
        def __init__(
            self,
            name="",
            help_text="",
            ctrl=10,
            rect=(0, 0, 100, 20),
            range_val=None,
            val_str=None,
            toggle=None,
        ):
            self.CurrentName = name
            self.CachedName = name
            self.CachedHelpText = help_text
            self.CachedControlType = ctrl
            self.CachedBoundingRectangle = SimpleNamespace(left=rect[0], top=rect[1], right=rect[2], bottom=rect[3])
            self._props = {}
            if range_val is not None:
                self._props[fake_uia.UIA_RangeValueValuePropertyId] = range_val
                self._props[fake_uia.UIA_RangeValueMinimumPropertyId] = 0.0
                self._props[fake_uia.UIA_RangeValueMaximumPropertyId] = 100.0
            if val_str is not None:
                self._props[fake_uia.UIA_ValueValuePropertyId] = val_str
            if toggle is not None:
                self._props[fake_uia.UIA_ToggleToggleStatePropertyId] = toggle

        def GetCurrentPropertyValue(self, pid):
            if pid in self._props:
                return self._props[pid]
            raise ValueError("missing prop")

    # _normalized_slider & _is_master_active paths
    assert rb_live._normalized_slider(FakeEl(range_val=75.0), fake_uia) == 0.75
    assert rb_live._normalized_slider(FakeEl(val_str="40 %"), fake_uia) == 0.4
    assert rb_live._normalized_slider(FakeEl(), fake_uia, "0.25") == 0.25
    assert rb_live._normalized_slider(FakeEl(), fake_uia, "") is None
    assert rb_live._is_master_active(FakeEl(toggle=1), fake_uia, "MASTER") is True
    assert rb_live._is_master_active(FakeEl(), fake_uia, "Master Active") is True

    # Build 2 decks (placed unsorted in node list to verify stable left-to-right sorting!)
    # Deck 2 (x ~ 800) placed BEFORE Deck 1 (x ~ 200) in nodes list:
    el_list = [
        # Deck 2 labels
        FakeEl("Track Two", "", 10, (800, 100, 900, 120)),
        FakeEl("Artist Two", "", 10, (800, 120, 900, 140)),
        FakeEl("140.0", "", 10, (800, 140, 860, 160)),
        FakeEl("9A", "Key:", 10, (800, 160, 860, 180)),
        FakeEl("-03:00", "", 10, (800, 180, 860, 200)),
        FakeEl(".0", "", 10, (860, 180, 880, 200)),
        FakeEl("01:00", "", 10, (890, 180, 950, 200)),
        FakeEl(".5", "", 10, (950, 180, 970, 200)),
        # Deck 1 labels
        FakeEl("Track One", "", 10, (200, 100, 300, 120)),
        FakeEl("Artist One", "", 10, (200, 120, 300, 140)),
        FakeEl("128.0", "", 10, (200, 140, 260, 160)),
        FakeEl("8A", "Tonart:", 10, (200, 160, 260, 180)),
        FakeEl("-04:00", "", 10, (200, 180, 260, 200)),
        FakeEl(".0", "", 10, (260, 180, 280, 200)),
        FakeEl("00:10", "", 10, (290, 180, 350, 200)),
        FakeEl(".0", "", 10, (350, 180, 370, 200)),
        # Tempo edits + Current key buttons + Faders + Crossfader + Master
        FakeEl("140.0", "Deck BPM Display:", 11, (850, 140, 900, 160), val_str="140.0"),
        FakeEl("128.0", "Deck BPM Display:", 11, (250, 140, 300, 160), val_str="128.0"),
        FakeEl("9A", "Current key.", 13, (860, 160, 900, 180)),
        FakeEl("8A", "Aktuelle Tonart.", 13, (260, 160, 300, 180)),
        FakeEl("CH1 Fader", "Kanalfader", 12, (250, 400, 280, 520), range_val=10.0),
        FakeEl("CH2 Fader", "Kanalfader", 12, (850, 400, 880, 520), range_val=100.0),
        FakeEl("Crossfader", "Crossfader", 12, (480, 520, 660, 545), range_val=100.0),
        FakeEl("MASTER", "Master", 13, (840, 210, 890, 230), toggle=1),
    ]

    fake_nodes = SimpleNamespace(Length=len(el_list), GetElement=lambda idx: el_list[idx])
    fake_automation = SimpleNamespace(
        ElementFromHandle=lambda _hwnd: SimpleNamespace(FindAllBuildCache=lambda *_a: fake_nodes),
        CreateCacheRequest=lambda: SimpleNamespace(AddProperty=lambda *_a: None),
        CreateOrCondition=lambda a, b: (a, b),
        CreatePropertyCondition=lambda a, b: (a, b),
        CreatePropertyConditionEx=lambda a, b, c: (a, b, c),
    )

    discovered = rb_live._discover(fake_automation, fake_uia, 12345)
    assert len(discovered) == 2
    # Left-to-right sorting keeps Track One as Deck 1, Track Two as Deck 2
    assert discovered[0][0].CurrentName == "Track One"
    assert discovered[1][0].CurrentName == "Track Two"

    # Full _run integration with synthetic advancement
    monkeypatch.setattr(rb_live, "_rekordbox_window", lambda: 12345)
    monkeypatch.setattr(rb_live, "_discover", lambda *_a: discovered)

    fake_comtypes_client = types.ModuleType("comtypes.client")
    fake_comtypes_client.GetModule = lambda *_a: fake_uia
    fake_comtypes_client.CreateObject = lambda *_a, **_k: fake_automation
    fake_comtypes = types.ModuleType("comtypes")
    fake_comtypes.COMError = RuntimeError
    fake_comtypes.CoInitialize = lambda: None
    fake_comtypes.CoUninitialize = lambda: None
    fake_comtypes.client = fake_comtypes_client
    monkeypatch.setitem(sys.modules, "comtypes", fake_comtypes)
    monkeypatch.setitem(sys.modules, "comtypes.client", fake_comtypes_client)
    fake_uia.CUIAutomation = "uia"
    fake_uia.IUIAutomation = "iuia"

    class DummyStop:
        def __init__(self, limit=2):
            self.count = 0
            self.limit = limit
            self.closed = False

        def is_set(self):
            return self.closed or self.count >= self.limit

        def set(self):
            self.closed = True

        def wait(self, _sec):
            self.count += 1
            el_list[7].CurrentName = ".8"
            el_list[6].CurrentName = "01:00"

    pb_non_win = rb_live.RekordboxPlayback.__new__(rb_live.RekordboxPlayback)
    pb_non_win._stop = DummyStop(limit=0)
    pb_non_win._reading = (0, False, [])
    pb_non_win._thread = None
    assert pb_non_win.snapshot() == (False, [])

    pb = rb_live.RekordboxPlayback.__new__(rb_live.RekordboxPlayback)
    pb._reading = (0, False, [])
    pb._thread = None
    pb._stop = DummyStop(limit=2)
    ticks = iter([100.0, 100.1, 100.2, 100.6, 100.7, 100.8, 100.9])
    monkeypatch.setattr(rb_live.time, "monotonic", lambda: next(ticks, 101.0))
    pb._run()
    connected, decks = pb.snapshot()
    assert connected is True
    assert len(decks) == 2
    assert decks[0]["playing"] is False
    assert decks[1]["playing"] is True
    assert decks[1]["master"] is True
    assert decks[1]["fader"] == 1.0
    assert decks[0]["fader"] == 0.0
    pb.close()


# ---------------------------------------------------------------------------
# 7. main.py — Fader/Crossfader Sticky Anchor + alle Handle/IPC Zweige
# ---------------------------------------------------------------------------

def test_main_fader_disambiguation_hysteresis_and_ipc(tmp_path, monkeypatch):
    class FakePlayback:
        def __init__(self):
            self.decks = []
            self.connected = True

        def snapshot(self):
            return self.connected, self.decks

        def close(self):
            pass

    playback = FakePlayback()
    core = main_mod.Core(local_playback=playback)
    core.replace_library(lib_mod.Library(None, "Master", [
        {"id": "10", "title": "Deck One Track", "artist": "Artist A", "bpm": 128, "key_raw": "8A", "seconds": 300},
        {"id": "20", "title": "Deck Two Track", "artist": "Artist B", "bpm": 135, "key_raw": "9A", "seconds": 310},
        {"id": "30", "title": "Match B", "artist": "Artist C", "bpm": 135, "key_raw": "9A", "seconds": 310},
    ]))

    # Case 1: Both tracks playing, Deck 1 fader = 0.0 (closed), Deck 2 fader = 1.0 -> MUST pick Deck 2!
    playback.decks = [
        {"deck": 1, "title": "Deck One Track", "artist": "Artist A", "bpm": 128, "original_bpm": 128,
         "key": "8A", "seconds": 300, "playing": True, "fader": 0.0, "master": False},
        {"deck": 2, "title": "Deck Two Track", "artist": "Artist B", "bpm": 135, "original_bpm": 135,
         "key": "9A", "seconds": 310, "playing": True, "fader": 1.0, "master": True},
    ]
    st = core.status({})
    assert st["anchor"] == 2
    assert st["decks"][1]["fader"] == 1.0

    # Case 2: Both playing, Deck 1 raised slightly to 0.95 (diff < 0.10) -> Deck 2 stays sticky (no flip-flop!)
    playback.decks[0]["fader"] = 0.95
    st = core.status({})
    assert st["anchor"] == 2

    # Case 3: Deck 2 faded down to 0.2 while Deck 1 at 0.95 (diff >= 0.10) -> cleanly hands over to Deck 1!
    playback.decks[1]["fader"] = 0.2
    playback.decks[1]["master"] = False
    playback.decks[0]["master"] = True
    st = core.status({})
    assert st["anchor"] == 1

    # Handle commands: demoLibrary, query, detail, interfaces, usb, linkStart, linkStop, demoLink, bind/unbind errors
    empty_core = main_mod.Core(local_playback=FakePlayback())
    with pytest.raises(ValueError, match="Öffne zuerst"):
        empty_core.handle("query", {})
    assert empty_core.handle("detail", {"id": "1"}) is None
    empty_core.local_playback.close()

    # Demo link mode, preferred deck, no-fader fallback & pause anchor reset
    core.demo = True
    core.demo_index = 0
    demo_st = core.status({"bpmTolerance": 6, "sameGenre": False, "harmonic": True})
    assert demo_st["state"] == "demo" and len(demo_st["decks"]) == 1
    core.demo = False

    # No faders -> master or playing fallback + pause resets anchor to None
    playback.decks = [
        {"deck": 1, "title": "Deck One Track", "artist": "Artist A", "bpm": 128, "original_bpm": 128,
         "key": "8A", "seconds": 300, "playing": True, "master": False},
        {"deck": 2, "title": "Deck Two Track", "artist": "Artist B", "bpm": 135, "original_bpm": 135,
         "key": "9A", "seconds": 310, "playing": True, "master": True},
    ]
    assert core.status({"deck": 1})["anchor"] == 1
    core._last_anchor = None
    assert core.status({})["anchor"] == 2
    playback.decks[0]["playing"] = False
    playback.decks[1]["playing"] = False
    assert core.status({})["anchor"] is None

    # Rekordbox disconnected falls through to Pro DJ Link status
    playback.connected = False
    playback.decks = []
    off_st = core.status({})
    assert off_st["state"] == "off"

    # Non-playing COM/disconnected branches in rekordbox_live
    assert rb_live.combine_fader_levels(0.8, 0.0, 3, 4) == 0.8
    assert rb_live.combine_fader_levels(0.8, 1.0, 4, 4) == 0.8
    assert rb_live._position("01:02", ".bad") == 62.0
    assert rb_live._tempo("132.5") == 132.5
    assert rb_live._tempo("abc") is None

    assert core.handle("demoLibrary", {})["kind"] == "Demo"
    sample_db = tmp_path / "m.db"
    fixtures.generate(sample_db, 12)
    assert core.handle("open", {"path": str(sample_db)})["kind"] == "Master"
    assert core.handle("demoLibrary", {"path": str(sample_db)})["kind"] == "Demo"

    first_id = core.handle("query", {})["rows"][0]["id"]
    assert core.handle("detail", {"id": first_id})["id"] == first_id
    assert isinstance(core.handle("interfaces", {}), list)
    monkeypatch.setattr(main_mod, "usb_sources", lambda: ["C:/fake/exportLibrary.db"])
    assert isinstance(core.handle("usb", {}), list)

    monkeypatch.setattr(core.link, "start", lambda ip, ann: None)
    assert core.handle("linkStart", {"ip": "127.0.0.1", "announce": False}) is True
    assert core.handle("linkStop", {}) is True
    assert core.handle("demoLink", {"index": 2}) is True
    assert core.demo_index == 2
    assert core.handle("demoLink", {"next": True}) is True
    assert core.demo_index == 3

    with pytest.raises(ValueError, match="Player"):
        core.handle("bindMedia", {"source": 99, "slot": 3, "path": str(sample_db)})

    usb_db = tmp_path / "exportLibrary.db"
    with sqlite3.connect(usb_db) as conn:
        conn.executescript("""
            CREATE TABLE artist (artist_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE genre (genre_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE key (key_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE album (album_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE label (label_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE content (
                content_id TEXT PRIMARY KEY, title TEXT, path TEXT, releaseYear INTEGER,
                dateCreated TEXT, dateAdded TEXT, djComment TEXT, rating INTEGER,
                length INTEGER, fileSize INTEGER, bitrate INTEGER, samplingRate INTEGER,
                djPlayCount INTEGER, bpmx100 INTEGER, analysisDataFilePath TEXT, isrc TEXT,
                masterContentId TEXT, artist_id_artist TEXT, genre_id TEXT, key_id TEXT,
                album_id TEXT, label_id TEXT
            );
        """)
    # Case 4: Unbound cleanup & bind replacement + OneLibrary/Device Library status
    usb2_db = tmp_path / "export2.db"
    usb2_db.write_bytes(usb_db.read_bytes())
    assert core.handle("bindMedia", {"source": 1, "slot": 3, "path": str(usb2_db)}) is True
    assert core.handle("unbindMedia", {"source": 1, "slot": 3}) is True
    assert core.handle("unbindMedia", {"source": 1, "slot": 3}) is True
    with pytest.raises(ValueError, match="exportLibrary"):
        core.handle("bindMedia", {"source": 1, "slot": 3, "path": str(sample_db)})
    with pytest.raises(ValueError, match="Unbekannter Befehl"):
        core.handle("unknownMethod", {})

    # main() stdin/stdout loop
    monkeypatch.setattr(main_mod, "RekordboxPlayback", FakePlayback)
    stdin_buf = io.StringIO(
        json.dumps({"id": 1, "method": "demoLibrary", "params": {}}) + "\n"
        + json.dumps({"id": 2, "method": "badMethod", "params": {}}) + "\n"
    )
    stdin_buf.reconfigure = lambda **_kw: None
    stdout_buf = io.StringIO()
    stdout_buf.reconfigure = lambda **_kw: None
    monkeypatch.setattr(sys, "stdin", stdin_buf)
    monkeypatch.setattr(sys, "stdout", stdout_buf)
    main_mod.main()
    lines = [json.loads(line) for line in stdout_buf.getvalue().strip().splitlines()]
    assert lines[0]["id"] == 1 and lines[0]["result"]["kind"] == "Demo"
    assert lines[1]["id"] == 2 and "error" in lines[1]
    core.library.close()


# ---------------------------------------------------------------------------
# 8. Complete AST Mutation Killer Test Suite
# ---------------------------------------------------------------------------

def test_backend_ast_mutation_killer_suite():
    # --- 1. keys.py mutants ---
    # keys.py:26:1 (camelot remove unary not on if not classical)
    assert keys.camelot("D MAJOR") == "10B"
    assert keys.camelot("C MINOR") == "5A"
    assert keys.camelot("E DUR") == "12B"
    assert keys.camelot("A MOLL") == "8A"
    assert keys.camelot("1m") == "8A"
    assert keys.camelot("1d") == "8B"
    assert keys.camelot("12m") == "7A"
    assert keys.camelot("12d") == "7B"
    assert keys.camelot("C M") == "8B"
    assert keys.camelot("C m") == "5A"
    assert keys.camelot("C") == "8B"
    assert keys.camelot("") is None
    assert keys.camelot("INVALID") is None
    # pitch_class
    assert keys.pitch_class("F#") == 6
    assert keys.pitch_class("Gb") == 6
    assert keys.pitch_class("C#") == 1
    assert keys.pitch_class("Db") == 1
    # compatible
    assert keys.compatible("") == {}
    assert keys.compatible(None) == {}
    assert keys.compatible("8A") == {
        "8A": "Gleiche Tonart",
        "8B": "Paralleltonart",
        "7A": "Camelot −1",
        "9A": "Camelot +1",
    }
    assert keys.compatible("1A") == {
        "1A": "Gleiche Tonart",
        "1B": "Paralleltonart",
        "12A": "Camelot −1",
        "2A": "Camelot +1",
    }
    assert keys.compatible("12B") == {
        "12B": "Gleiche Tonart",
        "12A": "Paralleltonart",
        "11B": "Camelot −1",
        "1B": "Camelot +1",
    }

    # --- 2. library.py mutants ---
    # _key_rank
    assert lib_mod._key_rank("1A") == 2
    assert lib_mod._key_rank("1B") == 3
    assert lib_mod._key_rank("8A") == 16
    assert lib_mod._key_rank("8B") == 17
    assert lib_mod._key_rank("12A") == 24
    assert lib_mod._key_rank("12B") == 25
    assert lib_mod._key_rank("") is None
    assert lib_mod._key_rank(None) is None

    # _parse_range
    assert lib_mod._parse_range("120..140") == (120.0, 140.0)
    assert lib_mod._parse_range("140..120") == (120.0, 140.0)
    assert lib_mod._parse_range("120..120") == (120.0, 120.0)
    rng_zero = lib_mod._parse_range("0..-0")
    assert rng_zero == (0.0, -0.0)
    assert math.copysign(1.0, rng_zero[0]) == 1.0
    assert lib_mod._parse_range("120 bis 140") == (120.0, 140.0)
    assert lib_mod._parse_range("120 - 140") == (120.0, 140.0)
    assert lib_mod._parse_range("120;140") == (120.0, 140.0)
    assert lib_mod._parse_range("120,140") == (120.0, 140.0)
    assert lib_mod._parse_range("120") is None
    assert lib_mod._parse_range("120..abc") is None
    assert lib_mod._parse_range("abc..120") is None

    # Library test instance
    sample = [
        {"id": "1", "title": "Alpha", "artist": "Klara", "genre": "Techno", "bpm": 130.0,
         "key_raw": "8A", "rating": 5, "year": 2024, "seconds": 300, "plays": 2},
        {"id": "2", "title": "Beta", "artist": "Mika", "genre": "House", "bpm": 128.0,
         "key_raw": "9A", "rating": 4, "year": 2022, "seconds": 250, "plays": 5},
        {"id": "3", "title": "Gamma", "artist": "Nova", "genre": "Acid", "bpm": 135.0,
         "key_raw": "8A", "rating": 3, "year": 2020, "seconds": 280, "plays": 1},
        {"id": "4", "title": "", "artist": "", "genre": "", "bpm": None,
         "key_raw": "", "rating": 0, "year": None, "seconds": None, "plays": None},
    ]
    lib = lib_mod.Library(None, "Master", sample)
    try:
        # recommendations delta & relation & sorting
        recs = lib.recommendations(128.0, "8A", "2", 10.0, False)
        assert len(recs) == 2
        assert recs[0]["id"] == "1"
        assert recs[0]["delta"] == 2.0
        assert recs[0]["relation"] == "Gleiche Tonart"
        assert recs[1]["id"] == "3"
        assert recs[1]["delta"] == 7.0
        assert recs[1]["relation"] == "Gleiche Tonart"

        # recommendations sorting on same delta: same key precedes different key
        eq_sample = [
            {"id": "a", "title": "A", "artist": "X", "genre": "T", "bpm": 130.0, "key_raw": "8A", "rating": 3},
            {"id": "b", "title": "B", "artist": "Y", "genre": "T", "bpm": 130.0, "key_raw": "9A", "rating": 3},
        ]
        eq_lib = lib_mod.Library(None, "Master", eq_sample)
        try:
            eq_recs = eq_lib.recommendations(130.0, "8A", None, 5.0, False)
            assert [r["id"] for r in eq_recs] == ["a", "b"]
        finally:
            eq_lib.close()

        # recommendations empty checks
        assert lib.recommendations(None, "8A", None, 5.0, True) == []
        assert lib.recommendations(None, "8A", None, 5.0, False) == []
        assert lib.recommendations(130.0, None, None, 5.0, True) == []
        assert len(lib.recommendations(130.0, None, None, 5.0, False)) > 0
        assert len(lib.recommendations(130.0, "8A", None, 5.0, True)) > 0

        # recommendations tolerance bounds: bpm - tolerance and bpm + tolerance
        narrow_recs = lib.recommendations(129.0, "8A", None, 1.5, False)
        assert [r["id"] for r in narrow_recs] == ["1", "2"]

        # _apply_rule: numeric and key range exact boundary inclusion (raw >= lo and raw <= hi)
        res_bpm_130 = lib.query({"rules": [{"id": "bpm", "op": "range", "value": "130..130"}]})
        assert [r["id"] for r in res_bpm_130["rows"]] == ["1"]
        res_bpm_128 = lib.query({"rules": [{"id": "bpm", "op": "range", "value": "128..128"}]})
        assert [r["id"] for r in res_bpm_128["rows"]] == ["2"]
        res_key_8a = lib.query({"rules": [{"id": "key", "op": "range", "value": "8A..8A"}]})
        assert {r["id"] for r in res_key_8a["rows"]} == {"1", "3"}

        # _apply_rule: contains on key column
        res_key_cnt = lib.query({"rules": [{"id": "key", "op": "contains", "value": "8a"}]})
        assert [r["id"] for r in res_key_cnt["rows"]] == ["1", "3"]
        assert lib.query({"rules": [{"id": "key", "op": "contains", "value": "nonexistent"}]})["rows"] == []

        # _apply_rule: key range with one invalid part
        assert lib.query({"rules": [{"id": "key", "op": "range", "value": "8A..INVALID"}]})["rows"] == []
        assert lib.query({"rules": [{"id": "key", "op": "range", "value": "INVALID..8A"}]})["rows"] == []

        # _apply_rule: key comparisons & asc < 26 boundary (null key track 4 must be excluded)
        res_key_gte = lib.query({"rules": [{"id": "key", "op": "gte", "value": "8A"}]})
        assert {r["id"] for r in res_key_gte["rows"]} == {"1", "2", "3"}
        assert lib.query({"rules": [{"id": "key", "op": "gt", "value": "12B"}]})["rows"] == []
        assert lib.query({"rules": [{"id": "key", "op": "gte", "value": "12B"}]})["rows"] == []

        # _apply_rule: title string boundary operations (gte, gt, lte, lt)
        res_title_gte = lib.query({"rules": [{"id": "title", "op": "gte", "value": "Beta"}]})
        assert {r["id"] for r in res_title_gte["rows"]} == {"2", "3"}
        assert [r["id"] for r in lib.query({"rules": [{"id": "title", "op": "gt", "value": "Beta"}]})["rows"]] == ["3"]
        res_title_lte = lib.query({"rules": [{"id": "title", "op": "lte", "value": "Beta"}]})
        assert {r["id"] for r in res_title_lte["rows"]} == {"1", "2"}
        assert [r["id"] for r in lib.query({"rules": [{"id": "title", "op": "lt", "value": "Beta"}]})["rows"]] == ["1"]

        # _apply_rule: id comparisons (gte, gt, lte, lt)
        res_id_gte = lib.query({"rules": [{"id": "id", "op": "gte", "value": "2"}]})
        assert {r["id"] for r in res_id_gte["rows"]} == {"2", "3", "4"}
        assert {r["id"] for r in lib.query({"rules": [{"id": "id", "op": "gt", "value": "2"}]})["rows"]} == {"3", "4"}
        assert {r["id"] for r in lib.query({"rules": [{"id": "id", "op": "lte", "value": "2"}]})["rows"]} == {"1", "2"}
        assert [r["id"] for r in lib.query({"rules": [{"id": "id", "op": "lt", "value": "2"}]})["rows"]] == ["1"]

        # _apply_rule: text range reverse and equal
        res_rng_rev = lib.query({"rules": [{"id": "title", "op": "range", "value": "Gamma..Alpha"}]})
        assert {r["id"] for r in res_rng_rev["rows"]} == {"1", "2", "3"}
        res_rng_eq = lib.query({"rules": [{"id": "title", "op": "range", "value": "Beta..Beta"}]})
        assert [r["id"] for r in res_rng_eq["rows"]] == ["2"]

        # _sort_positions: single stage id asc / desc
        assert [r["id"] for r in lib.query({"sorts": [{"id": "id", "desc": True}]})["rows"]] == ["4", "3", "2", "1"]
        assert [r["id"] for r in lib.query({"sorts": [{"id": "id", "desc": False}]})["rows"]] == ["1", "2", "3", "4"]
        # single stage non-id
        s_bpm_asc = lib.query({"sorts": [{"id": "bpm", "desc": False}]})
        assert [r["id"] for r in s_bpm_asc["rows"]][:3] == ["2", "1", "3"]
        # multi-stage with id in used
        s_bpm_desc = lib.query({"sorts": [{"id": "bpm", "desc": True}, {"id": "id", "desc": False}]})
        assert [r["id"] for r in s_bpm_desc["rows"]][:3] == ["3", "1", "2"]
        s_id_first = lib.query({"sorts": [{"id": "id", "desc": False}, {"id": "bpm", "desc": True}]})
        assert [r["id"] for r in s_id_first["rows"]] == ["1", "2", "3", "4"]

        # multi-stage non-id where stage 1 breaks tie in stage 0 (kills len(stages) == 1 Eq -> NotEq)
        # Tracks 1 & 3 both have key 8A; track 1 has bpm 130, track 3 has bpm 135
        s_key_bpm_desc = lib.query({"sorts": [{"id": "key", "desc": False}, {"id": "bpm", "desc": True}]})
        assert [r["id"] for r in s_key_bpm_desc["rows"]][:2] == ["3", "1"]
        s_key_bpm_asc = lib.query({"sorts": [{"id": "key", "desc": False}, {"id": "bpm", "desc": False}]})
        assert [r["id"] for r in s_key_bpm_asc["rows"]][:2] == ["1", "3"]

        # _sort_positions: np.lexsort with input permutation (kills In -> NotIn on line 410)
        arr_idx = np.array([2, 0, 1])
        sorted_pos = lib._sort_positions(arr_idx, {"sorts": [{"id": "comment"}, {"id": "album"}]})
        assert list(sorted_pos) == [0, 1, 2]
    finally:
        lib.close()

    # --- 3. rekordbox_live.py mutants ---
    # _crossfader_gain
    assert rb_live._crossfader_gain(None, 1, 2) == 1.0
    assert rb_live._crossfader_gain(0.0, 1, 2) == 1.0
    assert rb_live._crossfader_gain(0.25, 1, 2) == 1.0
    assert rb_live._crossfader_gain(0.5, 1, 2) == 1.0
    assert rb_live._crossfader_gain(0.75, 1, 2) == 0.5
    assert rb_live._crossfader_gain(1.0, 1, 2) == 0.0
    assert rb_live._crossfader_gain(0.0, 2, 2) == 0.0
    assert rb_live._crossfader_gain(0.25, 2, 2) == 0.5
    assert rb_live._crossfader_gain(0.5, 2, 2) == 1.0
    assert rb_live._crossfader_gain(0.75, 2, 2) == 1.0
    assert rb_live._crossfader_gain(1.0, 2, 2) == 1.0
    assert rb_live._crossfader_gain(0.0, 1, 4) == 1.0

    # combine_fader_levels
    assert rb_live.combine_fader_levels(None, None, 1, 2) is None
    assert rb_live.combine_fader_levels(0.8, None, 1, 2) == 0.8
    assert rb_live.combine_fader_levels(0.8, 0.0, 1, 2) == 0.8
    assert rb_live.combine_fader_levels(0.8, 0.0, 2, 2) == 0.0

    # _progress
    last = ("Track A", "Artist B", 10.0, 1.0)
    assert rb_live._progress(None, "Track A", "Artist B", 10.5, 1.5) is False
    assert rb_live._progress(last, "Diff", "Artist B", 10.5, 1.5) is False
    assert rb_live._progress(last, "Track A", "Diff", 10.5, 1.5) is False
    assert rb_live._progress(last, "Track A", "Artist B", 10.5, 1.5) is True
    assert rb_live._progress(last, "Track A", "Artist B", 10.8, 1.2) is True
    assert rb_live._progress(last, "Track A", "Artist B", 10.02, 1.5) is False
    assert rb_live._progress(last, "Track A", "Artist B", 15.0, 1.5) is False
    assert rb_live._progress(last, "Track A", "Artist B", 10.5, 0.5) is False

    # --- 4. main.py mutants: _select_anchor ---
    core = main_mod.Core()
    assert core._select_anchor([], "rekordbox", None) is None
    assert core._select_anchor([{"deck": 1, "trackId": "0", "playing": True}], "rekordbox", None) is None
    d1 = {"deck": 1, "trackId": "t1", "playing": True, "fader": 0.8, "master": False}
    d2 = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.9, "master": True}
    assert core._select_anchor([d1, d2], "rekordbox", 1)["deck"] == 1
    assert core._select_anchor([d1, d2], "rekordbox", 2)["deck"] == 2

    # Inaudible fader filter
    inaudible = {"deck": 1, "trackId": "t1", "playing": True, "fader": 0.02, "master": False}
    audible = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.8, "master": False}
    assert core._select_anchor([inaudible, audible], "rekordbox", None)["deck"] == 2

    # _select_anchor: fader == 0.05 stripped in rekordbox mode (kills Gt -> GtE on line 117)
    core._last_anchor = 1
    d_fader_05 = {"deck": 1, "trackId": "t1", "playing": True, "fader": 0.05, "master": False}
    d_other_08 = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.08, "master": False}
    assert core._select_anchor([d_fader_05, d_other_08], "rekordbox", None)["deck"] == 2

    # Sticky anchor: challenger fader beat (diff >= 0.10)
    core._last_anchor = 1
    deck_prev = {"deck": 1, "trackId": "t1", "playing": True, "fader": 0.80, "master": False}
    deck_challenger = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.95, "master": False}
    assert core._select_anchor([deck_prev, deck_challenger], "rekordbox", None)["deck"] == 2

    # Sticky anchor: challenger within 0.10 stays with prev
    core._last_anchor = 1
    deck_close = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.85, "master": False}
    assert core._select_anchor([deck_prev, deck_close], "rekordbox", None)["deck"] == 1

    # Sticky anchor: challenger master beat
    core._last_anchor = 1
    deck_master = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.82, "master": True}
    assert core._select_anchor([deck_prev, deck_master], "rekordbox", None)["deck"] == 2

    # State != rekordbox with faders vs state == rekordbox (inaudible deck sticky behavior)
    core._last_anchor = 1
    d1_inaudible = {"deck": 1, "trackId": "t1", "playing": True, "fader": 0.02, "master": False}
    d2_low = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.08, "master": False}
    # In pro-dj-link: inaudible deck 1 is NOT stripped, so sticky anchor holds (diff 0.06 < 0.10) -> returns 1
    assert core._select_anchor([d1_inaudible, d2_low], "pro-dj-link", None)["deck"] == 1
    # In rekordbox: inaudible deck 1 IS stripped (< 0.05), so deck 2 is selected -> returns 2
    assert core._select_anchor([d1_inaudible, d2_low], "rekordbox", None)["deck"] == 2

    # Sticky anchor: prev is None with multiple available decks (prev is not None and len > 1)
    core._last_anchor = None
    assert core._select_anchor([d1, d2], "rekordbox", None)["deck"] == 2

    # Sticky anchor: exact boundary fader beat diff == 0.10 (0.20 - 0.10 == 0.10 -> hands over to challenger)
    core._last_anchor = 1
    d_prev_exact = {"deck": 1, "trackId": "t1", "playing": True, "fader": 0.10, "master": False}
    d_exact_fader = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.20, "master": False}
    assert core._select_anchor([d_prev_exact, d_exact_fader], "rekordbox", None)["deck"] == 2

    # Sticky anchor: diff == 0.05 with master does NOT beat prev (0.11 - 0.06 == 0.05, not < 0.05 -> stays with prev)
    core._last_anchor = 1
    d_prev_m = {"deck": 1, "trackId": "t1", "playing": True, "fader": 0.06, "master": False}
    d_exact_master = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.11, "master": True}
    assert core._select_anchor([d_prev_m, d_exact_master], "rekordbox", None)["deck"] == 1

    # Sticky anchor: diff < 0.05 with master DOES beat prev (0.83 - 0.80 = 0.03 < 0.05 -> hands over to challenger)
    core._last_anchor = 1
    d_master_low_diff = {"deck": 2, "trackId": "t2", "playing": True, "fader": 0.83, "master": True}
    assert core._select_anchor([deck_prev, d_master_low_diff], "rekordbox", None)["deck"] == 2

    # _select_anchor: fallback min tiebreakers when prev is None (kills remove unary not on lines 149 & 150)
    core._last_anchor = None
    # not playing tiebreaker: playing deck 2 must be chosen over paused deck 1 at equal faders
    d_p_off = {"deck": 1, "trackId": "t1", "playing": False, "fader": 1.0, "master": False}
    d_p_on = {"deck": 2, "trackId": "t2", "playing": True, "fader": 1.0, "master": False}
    assert core._select_anchor([d_p_off, d_p_on], "pro-dj-link", None)["deck"] == 2

    # not master tiebreaker: master deck 2 must be chosen over non-master deck 1 at equal faders
    d_m_off = {"deck": 1, "trackId": "t1", "playing": True, "fader": 1.0, "master": False}
    d_m_on = {"deck": 2, "trackId": "t2", "playing": True, "fader": 1.0, "master": True}
    assert core._select_anchor([d_m_off, d_m_on], "pro-dj-link", None)["deck"] == 2
