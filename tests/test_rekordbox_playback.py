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


def test_send_track_to_rekordbox_and_core_transport(monkeypatch):
    import pytest
    import rekordbox_live as rbl

    with pytest.raises(ValueError):
        rbl.send_track_to_rekordbox("bad", "Track")
    with pytest.raises(ValueError):
        rbl.send_track_to_rekordbox("reveal", "   ")

    copied = []
    no_win = rbl.send_track_to_rekordbox(
        "reveal",
        "All On You",
        file_path=r"E:\Music\all.mp3",
        window_fn=lambda: None,
        clipboard_fn=lambda text: copied.append(text) or True,
    )
    assert no_win["ok"] is False
    assert no_win["reason"] == "no_window"
    assert copied == ["All On You"]

    focused = []
    sent_keys = []
    res_d1 = rbl.send_track_to_rekordbox(
        "deck1",
        "All On You Ammo",
        window_fn=lambda: 12345,
        clipboard_fn=lambda text: True,
        focus_fn=lambda hwnd: focused.append(hwnd) or True,
        key_sender=lambda *keys: sent_keys.append(keys) or True,
        sleep_fn=lambda _: None,
    )
    assert res_d1["ok"] is True
    assert res_d1["deck"] == 1
    assert focused == [12345]
    assert sent_keys[0] == ("alt", "f")
    assert sent_keys == [
        ("alt", "f"),
        ("ctrl", "a"),
        ("back",),
        ("ctrl", "v"),
        ("enter",),
        ("down",),
        ("shift", "left"),
    ]

    sent_keys.clear()
    res_reveal = rbl.send_track_to_rekordbox(
        "reveal",
        "Track Reveal",
        file_path=r"E:\Music\reveal.mp3",
        window_fn=lambda: 999,
        clipboard_fn=lambda text: True,
        focus_fn=lambda hwnd: True,
        key_sender=lambda *keys: sent_keys.append(keys) or True,
        sleep_fn=lambda _: None,
    )
    assert res_reveal["ok"] is True
    assert res_reveal["reason"] == "sent"
    assert res_reveal["deck"] is None
    assert sent_keys[-1] == ("down",)
    assert sent_keys[0] == ("alt", "f")

    typed_fallback = []
    sent_keys.clear()
    res_fallback = rbl.send_track_to_rekordbox(
        "reveal",
        "Fallback Query",
        window_fn=lambda: 999,
        clipboard_fn=lambda text: False,
        focus_fn=lambda hwnd: True,
        key_sender=lambda *keys: sent_keys.append(keys) or True,
        type_sender=lambda text: typed_fallback.append(text) or True,
        sleep_fn=lambda _: None,
    )
    assert res_fallback["ok"] is True
    assert typed_fallback == ["Fallback Query"]
    assert ("ctrl", "v") not in sent_keys

    sent_keys.clear()
    res_d2 = rbl.send_track_to_rekordbox(
        "deck2",
        "Track B",
        window_fn=lambda: 999,
        clipboard_fn=lambda text: True,
        focus_fn=lambda hwnd: True,
        key_sender=lambda *keys: sent_keys.append(keys) or True,
        sleep_fn=lambda _: None,
    )
    assert res_d2["deck"] == 2
    assert sent_keys[-1] == ("shift", "right")

    # Exercise Win32 helpers with a lightweight mock WinDLL (all safe in-memory)
    # Assign plain functions on self so ctypes attribute assignment (.restype / .argtypes) works.
    class FakeWinDLL:
        def __init__(self, dll, use_last_error=False):
            self.dll = dll
            self.open_ok = True
            self.iconic = True
            self.alloc_handle = 1001
            self.target_tid = 22
            self._buf_ptr = 0
            self.show_calls = []
            self.attach_calls = []

            def is_iconic(hwnd):
                return self.iconic

            def show_window(hwnd, cmd):
                self.show_calls.append((hwnd, cmd))
                return True

            def get_current_thread_id():
                return 11

            def get_window_thread_process_id(hwnd, ptr):
                return self.target_tid

            def attach_thread_input(a, b, attach):
                self.attach_calls.append((a, b, attach))
                return True

            def bring_window_to_top(hwnd):
                return True

            def set_foreground_window(hwnd):
                return True

            def global_alloc(flags, size):
                return self.alloc_handle

            def global_lock(hmem):
                return self._buf_ptr

            def global_unlock(hmem):
                return True

            def open_clipboard(hwnd):
                return self.open_ok

            def empty_clipboard():
                return True

            def set_clipboard_data(fmt, hmem):
                return hmem

            def close_clipboard():
                return True

            def send_input(count, arr, size):
                return count

            self.IsIconic = is_iconic
            self.ShowWindow = show_window
            self.GetCurrentThreadId = get_current_thread_id
            self.GetWindowThreadProcessId = get_window_thread_process_id
            self.AttachThreadInput = attach_thread_input
            self.BringWindowToTop = bring_window_to_top
            self.SetForegroundWindow = set_foreground_window
            self.GetForegroundWindow = lambda: 555
            self.GlobalAlloc = global_alloc
            self.GlobalLock = global_lock
            self.GlobalUnlock = global_unlock
            self.OpenClipboard = open_clipboard
            self.EmptyClipboard = empty_clipboard
            self.SetClipboardData = set_clipboard_data
            self.CloseClipboard = close_clipboard
            self.SendInput = send_input

    import ctypes

    buf = ctypes.create_unicode_buffer(32)
    dll_mock = FakeWinDLL("user32")
    dll_mock._buf_ptr = ctypes.addressof(buf)
    monkeypatch.setattr(rbl.ctypes, "WinDLL", lambda name, use_last_error=False: dll_mock)
    monkeypatch.setattr(rbl.os, "name", "nt")
    assert rbl._focus_window(555) is True
    assert dll_mock.show_calls == [(555, 9)]
    assert dll_mock.attach_calls == [(11, 22, True), (11, 22, False)]
    dll_mock.iconic = False
    dll_mock.target_tid = 11
    dll_mock.show_calls.clear()
    dll_mock.attach_calls.clear()
    assert rbl._focus_window(555) is True
    assert dll_mock.show_calls == []
    assert dll_mock.attach_calls == []
    assert rbl._focus_window(0) is False
    assert rbl._send_combo("shift", "left") is True
    assert rbl._send_combo("ctrl", "f") is True
    assert rbl._send_combo() is False
    assert rbl._type_unicode("Test") is True
    assert rbl._type_unicode("") is False
    assert rbl._set_clipboard_text("Test") is True
    dll_mock.alloc_handle = 0
    assert rbl._set_clipboard_text("Test") is False
    dll_mock.alloc_handle = 1001
    dll_mock._buf_ptr = 0
    assert rbl._set_clipboard_text("Test") is False
    dll_mock.open_ok = False
    assert rbl._set_clipboard_text("Test") is False
    monkeypatch.setattr(rbl.os, "name", "posix")
    assert rbl._focus_window(555) is False
    assert rbl._send_combo("ctrl", "f") is False
    assert rbl._type_unicode("Test") is False
    assert rbl._set_clipboard_text("Test") is False

    # Core.handle("rekordboxTransport")
    import main as app_main

    monkeypatch.setattr(
        app_main,
        "send_track_to_rekordbox",
        lambda a, q, p="": {"ok": True, "action": a, "query": q, "path": p},
    )
    core = Core()
    core.replace_library(Library(None, "Master", [
        {"id": "t1", "title": "Pulse", "artist": "Unit", "path": "C:/music/pulse.wav"},
    ]))
    try:
        res = core.handle("rekordboxTransport", {"id": "t1", "action": "deck1"})
        assert res == {"ok": True, "action": "deck1", "query": "Pulse Unit", "path": "C:/music/pulse.wav"}
        res_direct = core.handle("rekordboxTransport", {"query": "Manual Search", "path": "D:/music/x.aiff"})
        assert res_direct == {"ok": True, "action": "reveal", "query": "Manual Search", "path": "D:/music/x.aiff"}
    finally:
        core.library.close()
