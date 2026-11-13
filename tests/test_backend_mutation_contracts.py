"""Small fixtures for mutation-sensitive filter and deck-selection boundaries."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from keys import camelot
from library import Library
from main import Core
from rekordbox_live import _progress, combine_fader_levels


def test_open_key_maps_all_numbers_in_both_modes():
    wheel_order = (8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7)
    assert [camelot(f"{number}m") for number in range(1, 13)] == [f"{index}A" for index in wheel_order]
    assert [camelot(f"{number}d") for number in range(1, 13)] == [f"{index}B" for index in wheel_order]


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


def test_multiple_sort_stages_resolve_ties_in_priority_order():
    library = Library(None, "Master", [
        {"id": "1", "year": 2020, "bpm": 120},
        {"id": "2", "year": 2020, "bpm": 130},
        {"id": "3", "year": 2019, "bpm": 100},
        {"id": "4", "year": 2020, "bpm": 130},
    ])
    sorts = [{"id": "year", "desc": False}, {"id": "bpm", "desc": True}]
    try:
        request = {"sorts": sorts, "idsOnly": True, "facets": False}
        assert library.query(request)["rows"] == ["3", "2", "4", "1"]
        request["sorts"] = [*sorts, {"id": "id", "desc": True}]
        assert library.query(request)["rows"] == ["3", "4", "2", "1"]
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


def test_anchor_prefers_playing_then_master_when_levels_tie():
    core = Core()
    decks = [deck(1, playing=False, master=True), deck(2), deck(3, master=True)]
    assert core._select_anchor(decks, "demo", None) == decks[2]
    assert core._select_anchor([decks[1]], "demo", None) == decks[1]
    assert core._select_anchor([decks[1]], "demo", None) == decks[1]


@pytest.mark.parametrize(("position", "left", "right"), [(0.25, 0.8, 0.4), (0.5, 0.8, 0.8), (0.75, 0.4, 0.8)])
def test_crossfader_center_and_both_sides(position, left, right):
    assert combine_fader_levels(0.8, position, 1, 2) == left
    assert combine_fader_levels(0.8, position, 2, 2) == right


def test_playback_progress_accepts_forward_step_and_rejects_clock_tearing():
    previous = ("Track", "Artist", 10.0, 20.0)
    assert _progress(previous, "Track", "Artist", 10.25, 20.05)
    assert not _progress(previous, "Track", "Artist", 10.50, 20.05)
