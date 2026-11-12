import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from library import Library
from main import Core
from rekordbox_live import _position, _progress


def test_playback_progress_ignores_paused_or_changed_deck():
    last = ("Track", "Artist", 4.3, 1.0)
    assert _position("00:04", ".3") == 4.3
    assert _position("-02:03", ".5") == -123.5
    assert _progress(last, "Track", "Artist", 4.7, 1.4)
    assert not _progress(last, "Track", "Artist", 4.3, 1.4)
    assert not _progress(last, "New track", "Artist", 4.7, 1.4)
    assert not _progress(last, "Track", "Artist", 154.7, 1.4)


def test_local_playing_deck_drives_matches_with_effective_bpm():
    class Display:
        playing = True

        def snapshot(self):
            return True, [
                {"deck": 1, "title": "Paused", "artist": "", "playing": False,
                 "key": "11A", "bpm": 150, "original_bpm": 150, "seconds": None},
                {"deck": 2, "title": "Playing", "artist": "Artist", "playing": self.playing,
                 "key": "4A", "bpm": 131.31, "original_bpm": 130, "seconds": 358},
            ]

    playback = Display()
    core = Core(local_playback=playback)
    core.replace_library(Library(None, "Master", [
        {"id": "1", "title": "Playing", "artist": "Artist", "bpm": 130, "key_raw": "4A"},
        {"id": "2", "title": "Match", "bpm": 135.24, "key_raw": "5A"},
        {"id": "3", "title": "Out of range", "bpm": 135.25, "key_raw": "4B"},
        {"id": "4", "title": "Different key", "bpm": 131.31, "key_raw": "6A"},
    ]))
    try:
        status = core.handle("live", {"harmonic": True, "tolerance": 3})
        assert status["state"] == "rekordbox"
        assert status["anchor"] == 2
        assert status["decks"][1]["libraryId"] == "1"
        assert [match["id"] for match in status["matches"]] == ["2"]
        playback.playing = False
        assert core.handle("live", {})["anchor"] is None
        assert core.handle("live", {})["matches"] == []
    finally:
        core.library.close()
