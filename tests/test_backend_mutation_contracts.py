"""Small fixtures for mutation-sensitive filter and deck-selection boundaries."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from library import Library
from main import Core


@pytest.mark.parametrize(
    ("field", "bounds", "expected"),
    [
        ("bpm", "138.01..137.99", ["2", "3", "4"]),
        ("bpm", "138..138", ["3"]),
        ("key", "9A..8A", ["2", "3", "4"]),
        ("key", "8A..8A", ["2"]),
        ("key", "12B..12B", ["5"]),
    ],
)
def test_filter_ranges_include_both_edges(field, bounds, expected):
    rows = [
        {"id": "1", "bpm": 137.98, "key_raw": "7B"},
        {"id": "2", "bpm": 137.99, "key_raw": "8A"},
        {"id": "3", "bpm": 138, "key_raw": "8B"},
        {"id": "4", "bpm": 138.01, "key_raw": "9A"},
        {"id": "5", "bpm": 138.02, "key_raw": "12B"},
        {"id": "6", "bpm": None, "key_raw": None},
    ]
    library = Library(None, "Master", rows)
    try:
        result = library.query({
            "rules": [{"id": field, "op": "range", "value": bounds}],
            "sorts": [{"id": "id", "desc": False}],
            "idsOnly": True,
            "facets": False,
        })
        assert result["rows"] == expected
    finally:
        library.close()


def deck(number, fader=None, *, playing=True, master=False, track_id="12"):
    return {"deck": number, "trackId": track_id, "playing": playing, "fader": fader, "master": master}


def test_anchor_filters_paused_and_empty_rekordbox_decks_before_preference():
    core = Core()
    decks = [deck(1, playing=False), deck(2, track_id="0"), deck(3)]
    assert core._select_anchor(decks, "rekordbox", 1) is None
    assert core._select_anchor(decks, "rekordbox", 2) is None
    assert core._select_anchor(decks, "rekordbox", 3) == decks[2]
    assert core._select_anchor(decks, "demo", 1) == decks[0]


@pytest.mark.parametrize(
    ("state", "previous", "challenger", "challenger_master", "expected"),
    [
        ("rekordbox", 0.05, 0.10, False, 2),
        ("rekordbox", 0.06, 0.10, False, 1),
        ("rekordbox", 0.15, 0.25, False, 2),
        ("rekordbox", 0.15, 0.249, False, 1),
        ("rekordbox", 0.075, 0.125, True, 1),
        ("rekordbox", 0.075, 0.12, True, 2),
        ("rekordbox", 0.0, 0.02, False, 1),
        ("demo", 0.03, 0.06, False, 1),
    ],
)
def test_anchor_applies_inclusive_fader_and_exclusive_master_thresholds(
    state, previous, challenger, challenger_master, expected,
):
    core = Core()
    core._last_anchor = 1
    result = core._select_anchor([deck(1, previous), deck(2, challenger, master=challenger_master)], state, None)
    assert result["deck"] == expected
    assert core._last_anchor == expected
