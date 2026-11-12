"""Focused assertions for critical branches that were missed by the coverage run."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fixtures import generate
from library import Library
from main import Core
from rekordbox_live import send_track_to_rekordbox


def test_nested_query_rejects_invalid_range_in_and_and_skips_it_in_or(tmp_path):
    source = tmp_path / "master.db"
    generate(source, 3)
    library = Library.load(source)
    bad_range = {"id": "bpm", "op": "range", "value": "invalid"}
    id_rule = {"id": "id", "op": "eq", "value": "2"}
    try:
        and_result = library.query({"groups": [{"mode": "AND", "rules": [bad_range, id_rule]}]})
        or_result = library.query({"groups": [{"mode": "OR", "rules": [bad_range, id_rule]}]})
        assert and_result["rows"] == []
        assert [row["id"] for row in or_result["rows"]] == ["2"]
    finally:
        library.close()


def test_anchor_uses_best_playing_deck_when_all_faders_are_inaudible():
    core = Core.__new__(Core)
    core._last_anchor = None
    decks = [
        {"deck": 1, "trackId": "1", "playing": True, "fader": 0.02},
        {"deck": 2, "trackId": "2", "playing": True, "fader": 0.05},
    ]
    assert core._select_anchor(decks, "rekordbox", None) == decks[1]
    assert core._last_anchor == 2


def test_rekordbox_reveal_pastes_query_when_unicode_typing_fails():
    events = []
    result = send_track_to_rekordbox(
        "reveal", " Test Track ",
        window_fn=lambda: 123,
        clipboard_fn=lambda query: events.append(("clipboard", query)) or True,
        focus_fn=lambda hwnd: events.append(("focus", hwnd)),
        key_sender=lambda *keys: events.append(keys),
        type_sender=lambda query: events.append(("type", query)) or False,
        sleep_fn=lambda _: None,
    )
    assert result["ok"] and result["copied"] and result["deck"] is None
    assert events == [
        ("clipboard", "Test Track"), ("focus", 123), ("alt", "f"), ("ctrl", "a"), ("back",),
        ("type", "Test Track"), ("ctrl", "v"), ("enter",), ("down",),
    ]
