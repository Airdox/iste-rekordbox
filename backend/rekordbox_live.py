"""Read the deck displays exposed by the local Rekordbox window."""

import ctypes
import os
import re
import threading
import time
from ctypes import wintypes
from dataclasses import dataclass

import psutil

from keys import camelot

KEY_LABEL = ("tonart:", "key:")
CURRENT_KEY = ("aktuelle tonart.", "current key.")
DECK_BPM = ("deck bpm display:", "deck-bpm-anzeige:", "bpm-anzeige des decks:")
CLOCK = re.compile(r"(-?)(\d{1,3}):([0-5]\d)")


def _rekordbox_window():
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    matches = []

    @callback_type
    def inspect(hwnd, _):
        title = ctypes.create_unicode_buffer(32)
        user32.GetWindowTextW(hwnd, title, len(title))
        if title.value.casefold() != "rekordbox":
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        try:
            if psutil.Process(pid.value).name().casefold() == "rekordbox.exe":
                matches.append(hwnd)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        return True

    user32.EnumWindows(inspect, 0)
    return matches[0] if len(matches) == 1 else None


def _tempo(value):
    try:
        bpm = float(str(value or "").replace(",", "."))
    except ValueError:
        return None
    return bpm if 0 < bpm < 655.35 else None


def _position(clock, fraction):
    match = CLOCK.fullmatch(clock or "")
    if not match:
        return None
    minus, minutes, seconds = match.groups()
    value = int(minutes) * 60 + int(seconds)
    if re.fullmatch(r"[.,]\d", fraction or ""):
        value += int(fraction[-1]) / 10
    return -value if minus else value


@dataclass
class Display:
    element: object
    name: str
    description: str
    x: int
    y: int


def _nearest(anchor, displays):
    if not displays:
        return None
    item = min(displays, key=lambda value: (anchor.x - value.x) ** 2 + (anchor.y - value.y) ** 2)
    displays.remove(item)
    return item.element


def _discover(automation, uia, hwnd):
    root = automation.ElementFromHandle(hwnd)
    cache = automation.CreateCacheRequest()
    for prop in (uia.UIA_NamePropertyId, uia.UIA_HelpTextPropertyId,
                 uia.UIA_ControlTypePropertyId, uia.UIA_BoundingRectanglePropertyId):
        cache.AddProperty(prop)
    types = uia.UIA_ControlTypePropertyId
    text_or_edit = automation.CreateOrCondition(
        automation.CreatePropertyCondition(types, uia.UIA_TextControlTypeId),
        automation.CreatePropertyCondition(types, uia.UIA_EditControlTypeId),
    )
    key_buttons = [automation.CreatePropertyConditionEx(uia.UIA_HelpTextPropertyId, prefix, 2)
                   for prefix in ("Aktuelle Tonart.", "Current key.")]
    condition = automation.CreateOrCondition(text_or_edit, automation.CreateOrCondition(*key_buttons))
    nodes = root.FindAllBuildCache(uia.TreeScope_Descendants, condition, cache)
    labels, tempos, current_keys = [], [], []
    for index in range(nodes.Length):
        element = nodes.GetElement(index)
        rect = element.CachedBoundingRectangle
        description = (element.CachedHelpText or "").casefold()
        display = Display(element, element.CachedName or "", description,
                          (rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2)
        if description.startswith(DECK_BPM):
            tempos.append(display)
        elif description.startswith(CURRENT_KEY):
            current_keys.append(display)
        elif element.CachedControlType == uia.UIA_TextControlTypeId:
            labels.append(display)

    decks = []
    for i, anchor in enumerate(labels):
        if i < 3 or not anchor.description.startswith(KEY_LABEL):
            continue
        clocks = labels[i + 1:i + 5]
        if len(clocks) != 4 or not CLOCK.fullmatch(clocks[2].name):
            continue
        title, artist, bpm = labels[i - 3:i]
        decks.append((title.element, artist.element, bpm.element, anchor.element,
                      *(clock.element for clock in clocks),
                      _nearest(anchor, tempos), _nearest(anchor, current_keys)))
    return decks


def _progress(previous, title, artist, position, now):
    if previous is None or position is None:
        return False
    old_title, old_artist, old_position, sampled = previous
    if old_position is None or (title, artist) != (old_title, old_artist):
        return False
    return 0.04 <= position - old_position <= (now - sampled) * 2.5 + 0.2


class RekordboxPlayback:
    def __init__(self):
        self._stop = threading.Event()
        self._reading = (0, False, [])
        self._thread = None
        if os.name == "nt":
            self._thread = threading.Thread(target=self._run, name="rekordbox-playback", daemon=True)
            self._thread.start()

    def close(self):
        self._stop.set()

    def snapshot(self):
        sampled, connected, decks = self._reading
        return (connected, decks) if time.monotonic() - sampled < 3 else (False, [])

    def _run(self):
        import comtypes
        from comtypes.client import CreateObject, GetModule

        comtypes.CoInitialize()
        try:
            uia = GetModule("UIAutomationCore.dll")
            automation = CreateObject(uia.CUIAutomation, interface=uia.IUIAutomation)
            hwnd, displays, previous = None, [], {}
            discover_at = 0
            while not self._stop.is_set():
                try:
                    current = _rekordbox_window()
                    if not current:
                        hwnd, displays, previous = None, [], {}
                    elif current != hwnd or time.monotonic() >= discover_at:
                        hwnd = current
                        displays = _discover(automation, uia, hwnd)
                        discover_at = time.monotonic() + (45 if displays else 3)
                    now = time.monotonic()
                    decks = []
                    for deck, controls in enumerate(displays, 1):
                        title, artist, base_bpm, original_key, rm, rf, em, ef, pitch_bpm, shifted_key = controls
                        name = title.CurrentName or ""
                        performer = artist.CurrentName or ""
                        original_bpm = _tempo(base_bpm.CurrentName)
                        current_bpm = _tempo(pitch_bpm.GetCurrentPropertyValue(uia.UIA_ValueValuePropertyId)) if pitch_bpm else None
                        elapsed = _position(em.CurrentName, ef.CurrentName)
                        remaining = _position(rm.CurrentName, rf.CurrentName)
                        position = elapsed if elapsed is not None else remaining
                        playing = _progress(previous.get(deck), name, performer, position, now)
                        previous[deck] = (name, performer, position, now)
                        if name and original_bpm:
                            decks.append({"deck": deck, "title": name, "artist": performer,
                                          "bpm": current_bpm or original_bpm, "original_bpm": original_bpm,
                                          "key": camelot(shifted_key.CurrentName if shifted_key else "") or camelot(original_key.CurrentName),
                                          "seconds": round(elapsed - remaining) if elapsed is not None and remaining is not None else None,
                                          "playing": playing})
                    self._reading = (time.monotonic(), bool(hwnd), decks)
                except (OSError, ValueError, comtypes.COMError):
                    hwnd, displays, previous = None, [], {}
                    self._reading = (time.monotonic(), False, [])
                self._stop.wait(0.35 if displays else 0.9)
        except (OSError, comtypes.COMError):
            self._reading = (time.monotonic(), False, [])
        finally:
            comtypes.CoUninitialize()
