"""Diagnostic helper to inspect Rekordbox UIAutomation deck labels, sliders, and faders."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import comtypes
from comtypes.client import CreateObject, GetModule
import rekordbox_live


def main():
    hwnd = rekordbox_live._rekordbox_window()
    if not hwnd:
        print("Kein sichtbares Rekordbox-Fenster gefunden (in interaktiver Windows-Desktop-Session ausfuehren).")
        return 1
    comtypes.CoInitialize()
    try:
        uia = GetModule("UIAutomationCore.dll")
        automation = CreateObject(uia.CUIAutomation, interface=uia.IUIAutomation)
        root = automation.ElementFromHandle(hwnd)
        slider_cond = automation.CreatePropertyCondition(uia.UIA_ControlTypePropertyId, uia.UIA_SliderControlTypeId)
        sliders = root.FindAll(uia.TreeScope_Descendants, slider_cond)
        print(f"Gefundene Slider im Rekordbox-Fenster ({sliders.Length}):")
        for i in range(sliders.Length):
            el = sliders.GetElement(i)
            rect = el.CurrentBoundingRectangle
            name = el.CurrentName or ""
            help_text = el.CurrentHelpText or ""
            val = rekordbox_live._normalized_slider(el, uia, name)
            print(
                f"  [{i}] name={name!r} help={help_text!r} "
                f"rect=({rect.left},{rect.top},{rect.right},{rect.bottom}) norm={val}"
            )
        displays = rekordbox_live._discover(automation, uia, hwnd)
        print(f"Erkannte Decks: {len(displays)}")
        for idx, d in enumerate(displays, 1):
            fader_val = rekordbox_live._normalized_slider(d[10], uia) if d[10] else None
            xf_val = rekordbox_live._normalized_slider(d[11], uia) if d[11] else None
            print(f"  Deck {idx}: title={d[0].CurrentName!r}, channel_fader={fader_val}, crossfader={xf_val}")
        return 0
    finally:
        comtypes.CoUninitialize()


if __name__ == "__main__":
    raise SystemExit(main())
