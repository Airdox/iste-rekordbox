"""Read the deck displays, faders, and crossfader exposed by the local Rekordbox window."""

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
CHANNEL_FADER_WORDS = ("channel fader", "kanalfader", "ch fader", "fader", "volume", "pegel")
CROSSFADER_WORDS = ("crossfader", "cross fader", "xfader")
MASTER_WORDS = ("master",)
CLOCK = re.compile(r"(-?)(\d{1,3}):([0-5]\d)")
NUMBER_RE = re.compile(r"-?\d+(?:[.,]\d+)?")


def _rekordbox_window():
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    matches = []

    @callback_type
    def inspect(hwnd, _):
        title = ctypes.create_unicode_buffer(64)
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


def _normalized_slider(element, uia, fallback_text=""):
    """Read a UIA RangeValue/Value as a float normalized into 0.0..1.0."""
    try:
        value = element.GetCurrentPropertyValue(uia.UIA_RangeValueValuePropertyId)
        minimum = element.GetCurrentPropertyValue(uia.UIA_RangeValueMinimumPropertyId)
        maximum = element.GetCurrentPropertyValue(uia.UIA_RangeValueMaximumPropertyId)
        if value is not None and minimum is not None and maximum is not None and float(maximum) > float(minimum):
            ratio = (float(value) - float(minimum)) / (float(maximum) - float(minimum))
            return max(0.0, min(1.0, ratio))
    except Exception:
        pass
    for prop_id in (getattr(uia, "UIA_ValueValuePropertyId", None), getattr(uia, "UIA_NamePropertyId", None)):
        if not prop_id:
            continue
        try:
            raw = element.GetCurrentPropertyValue(prop_id)
        except Exception:
            raw = None
        text = str(raw or "")
        match = NUMBER_RE.search(text)
        if match:
            num = float(match.group(0).replace(",", "."))
            if "%" in text or num > 1.0:
                return max(0.0, min(1.0, num / 100.0))
            if 0.0 <= num <= 1.0:
                return num
    match = NUMBER_RE.search(str(fallback_text or ""))
    if match:
        num = float(match.group(0).replace(",", "."))
        return max(0.0, min(1.0, num / 100.0 if ("%" in fallback_text or num > 1.0) else num))
    return None


def _is_master_active(element, uia, text):
    try:
        state = element.GetCurrentPropertyValue(uia.UIA_ToggleToggleStatePropertyId)
        if state in (1, True):
            return True
    except Exception:
        pass
    low = (text or "").casefold()
    return "master" in low and any(tok in low for tok in ("on", "aktiv", "active", "1"))


def _crossfader_gain(crossfader_pos, deck_index, total_decks):
    """Map crossfader position [0..1] to deck gain [0..1]."""
    if crossfader_pos is None or total_decks < 2:
        return 1.0
    pos = max(0.0, min(1.0, float(crossfader_pos)))
    # Odd decks (1, 3, ...) live on side A (left), even decks (2, 4, ...) live on side B (right).
    is_left = (deck_index % 2) == 1
    if is_left:
        return max(0.0, min(1.0, (1.0 - pos) * 2.0)) if pos > 0.5 else 1.0
    return max(0.0, min(1.0, pos * 2.0)) if pos < 0.5 else 1.0


def combine_fader_levels(channel_fader, crossfader_pos, deck_index, total_decks):
    """Combine channel fader and crossfader into an effective on-air level 0.0..1.0."""
    xf_gain = _crossfader_gain(crossfader_pos, deck_index, total_decks)
    if channel_fader is None and crossfader_pos is None:
        return None
    ch = 1.0 if channel_fader is None else max(0.0, min(1.0, float(channel_fader)))
    return round(ch * xf_gain, 3)


@dataclass
class Display:
    element: object
    name: str
    description: str
    x: int
    y: int
    width: int = 0
    height: int = 0


def _nearest(anchor, displays, max_dist=None):
    if not displays:
        return None
    item = min(displays, key=lambda value: (anchor.x - value.x) ** 2 + (anchor.y - value.y) ** 2)
    if max_dist is not None and ((anchor.x - item.x) ** 2 + (anchor.y - item.y) ** 2) > max_dist ** 2:
        return None
    displays.remove(item)
    return item.element


def _nearest_x(anchor, displays):
    if not displays:
        return None
    item = min(displays, key=lambda value: abs(anchor.x - value.x))
    displays.remove(item)
    return item


def _discover(automation, uia, hwnd):
    root = automation.ElementFromHandle(hwnd)
    cache = automation.CreateCacheRequest()
    for prop in (
        uia.UIA_NamePropertyId,
        uia.UIA_HelpTextPropertyId,
        uia.UIA_ControlTypePropertyId,
        uia.UIA_BoundingRectanglePropertyId,
    ):
        cache.AddProperty(prop)
    types = uia.UIA_ControlTypePropertyId
    text_or_edit = automation.CreateOrCondition(
        automation.CreatePropertyCondition(types, uia.UIA_TextControlTypeId),
        automation.CreatePropertyCondition(types, uia.UIA_EditControlTypeId),
    )
    slider_cond = automation.CreatePropertyCondition(types, uia.UIA_SliderControlTypeId)
    button_cond = automation.CreatePropertyCondition(types, uia.UIA_ButtonControlTypeId)
    key_buttons = [
        automation.CreatePropertyConditionEx(uia.UIA_HelpTextPropertyId, prefix, 2)
        for prefix in ("Aktuelle Tonart.", "Current key.")
    ]
    condition = automation.CreateOrCondition(
        automation.CreateOrCondition(text_or_edit, slider_cond),
        automation.CreateOrCondition(button_cond, automation.CreateOrCondition(*key_buttons)),
    )
    nodes = root.FindAllBuildCache(uia.TreeScope_Descendants, condition, cache)
    labels, tempos, current_keys, sliders, master_buttons = [], [], [], [], []
    for index in range(nodes.Length):
        element = nodes.GetElement(index)
        rect = element.CachedBoundingRectangle
        description = (element.CachedHelpText or "").casefold()
        name = element.CachedName or ""
        width = max(0, int(rect.right - rect.left))
        height = max(0, int(rect.bottom - rect.top))
        display = Display(
            element,
            name,
            description,
            (rect.left + rect.right) // 2,
            (rect.top + rect.bottom) // 2,
            width,
            height,
        )
        ctrl_type = element.CachedControlType
        if description.startswith(DECK_BPM):
            tempos.append(display)
        elif description.startswith(CURRENT_KEY):
            current_keys.append(display)
        elif ctrl_type == uia.UIA_SliderControlTypeId:
            sliders.append(display)
        elif ctrl_type == uia.UIA_ButtonControlTypeId:
            if any(word in description or word in name.casefold() for word in MASTER_WORDS):
                master_buttons.append(display)
        elif ctrl_type == uia.UIA_TextControlTypeId:
            labels.append(display)

    crossfaders = [
        s for s in sliders
        if any(w in s.description or w in s.name.casefold() for w in CROSSFADER_WORDS)
        or (s.width > max(40, s.height * 1.4))
    ]
    channel_faders = [
        s for s in sliders
        if s not in crossfaders and (
            any(w in s.description or w in s.name.casefold() for w in CHANNEL_FADER_WORDS)
            or s.height >= 45
        )
    ]
    crossfader_el = crossfaders[0].element if crossfaders else None

    raw_decks = []
    for i, anchor in enumerate(labels):
        if i < 3 or not anchor.description.startswith(KEY_LABEL):
            continue
        clocks = labels[i + 1:i + 5]
        if len(clocks) != 4 or not CLOCK.fullmatch(clocks[2].name):
            continue
        title, artist, bpm = labels[i - 3:i]
        raw_decks.append((anchor, title, artist, bpm, clocks))

    # Order decks stably left-to-right (and top-to-bottom in 4-deck view) so UIA node reordering cannot swap deck numbers.
    raw_decks.sort(key=lambda item: (item[0].y // 160, item[0].x))

    decks = []
    fader_pool = list(channel_faders)
    master_pool = list(master_buttons)
    for anchor, title, artist, bpm, clocks in raw_decks:
        fader = _nearest_x(anchor, fader_pool)
        master = _nearest(anchor, master_pool, max_dist=360)
        decks.append((
            title.element,
            artist.element,
            bpm.element,
            anchor.element,
            *(clock.element for clock in clocks),
            _nearest(anchor, tempos),
            _nearest(anchor, current_keys),
            fader.element if fader else None,
            crossfader_el,
            master,
        ))
    return decks


def _progress(previous, title, artist, position, now):
    if previous is None or position is None:
        return False
    old_title, old_artist, old_position, sampled = previous
    if old_position is None or (title, artist) != (old_title, old_artist):
        return False
    delta = position - old_position
    dt = max(0.05, now - sampled)
    # Require clear forward advancement (ignores sub-tick clock jitter and sec/tenths tear-reads).
    return 0.06 <= delta <= dt * 2.5 + 0.35


class RekordboxPlayback:
    HOLD_SECONDS = 1.15

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
            hwnd, displays, previous, hold_until = None, [], {}, {}
            discover_at = 0
            while not self._stop.is_set():
                try:
                    current = _rekordbox_window()
                    if not current:
                        hwnd, displays, previous, hold_until = None, [], {}, {}
                    elif current != hwnd or time.monotonic() >= discover_at:
                        hwnd = current
                        displays = _discover(automation, uia, hwnd)
                        discover_at = time.monotonic() + (45 if displays else 3)
                    now = time.monotonic()
                    decks = []
                    total_decks = len(displays)
                    for deck, controls in enumerate(displays, 1):
                        (
                            title, artist, base_bpm, original_key,
                            rm, rf, em, ef, pitch_bpm, shifted_key,
                            fader_el, xf_el, master_el,
                        ) = controls
                        name = title.CurrentName or ""
                        performer = artist.CurrentName or ""
                        original_bpm = _tempo(base_bpm.CurrentName)
                        current_bpm = (
                            _tempo(pitch_bpm.GetCurrentPropertyValue(uia.UIA_ValueValuePropertyId))
                            if pitch_bpm else None
                        )
                        elapsed = _position(em.CurrentName, ef.CurrentName)
                        remaining = _position(rm.CurrentName, rf.CurrentName)
                        position = elapsed if elapsed is not None else remaining
                        prev = previous.get(deck)
                        if prev and (prev[0], prev[1]) != (name, performer):
                            hold_until[deck] = 0.0
                        if _progress(prev, name, performer, position, now):
                            hold_until[deck] = now + self.HOLD_SECONDS
                        previous[deck] = (name, performer, position, now)
                        playing = now <= hold_until.get(deck, 0.0)
                        ch_level = _normalized_slider(fader_el, uia) if fader_el else None
                        xf_pos = _normalized_slider(xf_el, uia) if xf_el else None
                        fader_level = combine_fader_levels(ch_level, xf_pos, deck, total_decks)
                        master = _is_master_active(master_el, uia, getattr(master_el, "CurrentName", "")) if master_el else False
                        if name and original_bpm:
                            decks.append({
                                "deck": deck,
                                "title": name,
                                "artist": performer,
                                "bpm": current_bpm or original_bpm,
                                "original_bpm": original_bpm,
                                "key": camelot(shifted_key.CurrentName if shifted_key else "") or camelot(original_key.CurrentName),
                                "seconds": round(elapsed - remaining) if elapsed is not None and remaining is not None else None,
                                "playing": playing,
                                "fader": fader_level,
                                "channelFader": ch_level,
                                "crossfader": xf_pos,
                                "master": master,
                            })
                    self._reading = (time.monotonic(), bool(hwnd), decks)
                except (OSError, ValueError, comtypes.COMError):
                    hwnd, displays, previous, hold_until = None, [], {}, {}
                    self._reading = (time.monotonic(), False, [])
                self._stop.wait(0.35 if displays else 0.9)
        except (OSError, comtypes.COMError):
            self._reading = (time.monotonic(), False, [])
        finally:
            comtypes.CoUninitialize()
