"""Verify nested AND/OR rule groups, range operators, and demo deck cycling."""

import gc
import random
import re
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

import pytest

from generate_synthetic_db import DEFAULT_PATH, generate

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tests"))

from library import Library, folded, number
from main import Core
from test_combinatorial_stress import REFERENCE_SELECT, Reference


def parse_range(value):
    parts = [p.strip() for p in re.split(r"\.\.|;|,|\s+bis\s+|\s+[–—-]\s+", str(value or "").strip())]
    if len(parts) != 2:
        return None
    lo, hi = number(parts[0]), number(parts[1])
    if lo is None or hi is None:
        return None
    return (lo, hi) if lo <= hi else (hi, lo)


def oracle_rule_ids(ref: Reference, rule):
    field, op, value = rule["id"], rule["op"], rule.get("value")
    if op == "range":
        bounds = parse_range(value)
        if not bounds:
            return frozenset()
        lo, hi = bounds
        vals = ref.fields[field]
        return frozenset(tid for tid, v in vals.items() if v is not None and lo <= v <= hi)
    if op == "neq":
        vals = ref.fields[field]
        if field in ("title", "artist", "album", "genre", "label", "comment", "path", "added", "created", "isrc"):
            target = folded(str(value).strip()) if value is not None else ""
            if target == "":
                return frozenset(tid for tid, v in vals.items() if v is not None)
            return frozenset(tid for tid, v in vals.items() if v is not None and v != target)
        target = number(value)
        return frozenset(tid for tid, v in vals.items() if v is not None and v != target)
    if field in ("year", "seconds", "bytes", "bitrate", "sample_rate", "plays", "rating", "bpm") and op != "empty":
        value = number(value)
    return ref.matching(field, op, value)


def oracle_groups(ref: Reference, groups, logic, sorts):
    active_groups = []
    for group in groups:
        rules = [r for r in group["rules"] if r["op"] == "empty" or str(r.get("value", "")).strip() != ""]
        if not rules:
            continue
        sets = [oracle_rule_ids(ref, r) for r in rules]
        if group["mode"] == "OR":
            combined = frozenset().union(*sets)
        else:
            combined = sets[0]
            for s in sets[1:]:
                combined = combined & s
        active_groups.append(combined)
    if not active_groups:
        matched = frozenset(ref.ids)
    elif logic == "OR":
        matched = frozenset().union(*active_groups)
    else:
        matched = active_groups[0]
        for s in active_groups[1:]:
            matched = matched & s
    return ref.ordered(matched, sorts)


@pytest.fixture(scope="module")
def env():
    path = DEFAULT_PATH if DEFAULT_PATH.is_file() else generate(DEFAULT_PATH)
    lib = Library.load(str(path))
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        raw = [dict(row) for row in conn.execute(REFERENCE_SELECT)]
    ref = Reference(raw)
    yield lib, ref
    lib.close()


def test_filter_studio_presets_and_range(env):
    lib, ref = env
    cases = [
        (
            "AND",
            [
                {"mode": "OR", "rules": [{"id": "genre", "op": "eq", "value": "Techno"}, {"id": "genre", "op": "eq", "value": "Hardgroove"}]},
                {"mode": "AND", "rules": [{"id": "bpm", "op": "range", "value": "134..142"}, {"id": "rating", "op": "gte", "value": "4"}]},
            ],
            (("genre", False), ("year", True), ("bpm", False)),
        ),
        (
            "OR",
            [
                {"mode": "AND", "rules": [{"id": "bpm", "op": "range", "value": "120 bis 125"}, {"id": "plays", "op": "lte", "value": "2"}]},
                {"mode": "AND", "rules": [{"id": "key", "op": "eq", "value": "8A"}, {"id": "genre", "op": "neq", "value": "Techno"}]},
            ],
            (("bpm", False), ("title", False)),
        ),
        (
            "AND",
            [
                {"mode": "AND", "rules": [{"id": "genre", "op": "contains", "value": ""}]},  # empty ignored
                {"mode": "OR", "rules": [{"id": "year", "op": "range", "value": "2018;2024"}, {"id": "rating", "op": "eq", "value": "5"}]},
            ],
            (("year", True), ("rating", True)),
        ),
    ]
    for logic, groups, sorts in cases:
        expected = oracle_groups(ref, groups, logic, sorts)
        sort_payload = [{"id": f, "desc": d} for f, d in sorts]
        fast = lib.query({"groups": groups, "groupLogic": logic, "sorts": sort_payload, "facets": False, "idsOnly": True})
        full = lib.query({"groups": groups, "groupLogic": logic, "sorts": sort_payload, "facets": True})
        assert fast["rows"] == expected
        assert [r["id"] for r in full["rows"]] == expected
        assert full["counts"][-1] == len(expected)
        assert fast["ms"] < 50


def test_combinatorial_nested_groups(env):
    lib, ref = env
    rng = random.Random(90210)
    genres = ["Techno", "Hardgroove", "Melodic House", "Deep House", "Minimal", "Trance"]
    for i in range(400):
        logic = rng.choice(["AND", "OR"])
        groups = []
        for _ in range(rng.randint(1, 3)):
            mode = rng.choice(["AND", "OR"])
            rules = []
            for _ in range(rng.randint(1, 3)):
                choice = rng.randrange(5)
                if choice == 0:
                    rules.append({"id": "genre", "op": rng.choice(["eq", "neq", "contains"]), "value": rng.choice(genres)})
                elif choice == 1:
                    lo = rng.randint(110, 145)
                    hi = lo + rng.randint(2, 20)
                    rules.append({"id": "bpm", "op": "range", "value": f"{lo}..{hi}"})
                elif choice == 2:
                    rules.append({"id": "rating", "op": rng.choice(["gte", "eq", "lte"]), "value": str(rng.randint(1, 5))})
                elif choice == 3:
                    rules.append({"id": "year", "op": "range", "value": f"{rng.randint(1995, 2015)}..{rng.randint(2016, 2026)}"})
                else:
                    rules.append({"id": "artist", "op": rng.choice(["contains", "empty"]), "value": "Noire"})
            groups.append({"mode": mode, "rules": rules})
        sorts = tuple((f, bool(rng.getrandbits(1))) for f in rng.sample(["genre", "year", "bpm", "title", "rating", "key"], rng.randint(1, 3)))
        expected = oracle_groups(ref, groups, logic, sorts)
        payload = {"groups": groups, "groupLogic": logic, "sorts": [{"id": f, "desc": d} for f, d in sorts], "facets": i % 40 == 0, "idsOnly": i % 40 != 0}
        if i % 100 == 0:
            gc.collect()
        gc.disable()
        res = lib.query(payload)
        gc.enable()
        elapsed = res["ms"]
        if elapsed >= 50:
            for _ in range(3):
                gc.disable()
                elapsed = min(elapsed, lib.query(payload)["ms"])
                gc.enable()
                if elapsed < 50:
                    break
        actual = res["rows"] if i % 40 != 0 else [r["id"] for r in res["rows"]]
        assert actual == expected
        assert elapsed < 50


def test_demo_link_cycling_and_deck_metadata(env):
    lib, _ = env
    core = Core()
    core.library = lib
    core.handle("demoLink", {"index": 0})
    first = core.status({})
    assert first["state"] == "demo"
    assert len(first["decks"]) == 1
    d1 = first["decks"][0]
    assert d1["title"] and d1["bpm"] and d1["key"] and d1["genre"] is not None and d1["seconds"]

    core.handle("demoLink", {"next": True})
    second = core.status({})
    d2 = second["decks"][0]
    assert d2["trackId"] != d1["trackId"]
    core.handle("linkStop", {})
    assert core.status({})["state"] == "off"
