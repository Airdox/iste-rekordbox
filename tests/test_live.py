import hashlib
import socket
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from library import Library
from live import MAGIC, DjLink, _listener, announcement, decode_status
from main import Core


def packet(deck=2, source=3, slot=3, track=7, bpm=13800, pitch=0x100000, flags=0x40, track_type=1):
    data = bytearray(0xD4)
    data[:11] = MAGIC + b"\x0a"
    data[0x0B:0x12] = b"CDJ-900"
    data[0x21] = data[0x24] = deck
    data[0x28:0x2B] = bytes((source, slot, track_type))
    data[0x2C:0x30] = track.to_bytes(4, "big")
    data[0x89] = flags
    data[0x8C:0x90] = pitch.to_bytes(4, "big")
    data[0x92:0x94] = bpm.to_bytes(2, "big")
    return bytes(data)


def track(id_, title, bpm, key="8A"):
    return {"id": id_, "title": title, "artist": "Artist", "path": f"/Export/{title}.mp3",
            "bpm": bpm, "key_raw": key, "seconds": 240}


class TestDjLink(unittest.TestCase):
    def test_status_and_pitch(self):
        status = decode_status(packet(pitch=0x108000, flags=0x60))
        self.assertEqual(status["bpm"], 142.31)
        self.assertEqual((status["deck"], status["source"], status["slot"], status["trackId"]), (2, 3, 3, "7"))
        self.assertTrue(status["playing"] and status["master"])
        self.assertIsNone(decode_status(packet(bpm=0xFFFF))["bpm"])
        self.assertIsNone(decode_status(packet(deck=0)))
        self.assertIsNone(decode_status(packet()[:100]))
        self.assertIsNone(decode_status(b"x" + packet()[1:]))

    def test_announcement_fields(self):
        local = {"ip": "169.254.1.2", "mac": "11-22-33-44-55-66"}
        data = announcement(local, 7)
        self.assertEqual(len(data), 54)
        self.assertEqual(data[:11], MAGIC + b"\x06")
        self.assertEqual(data[0x24], 7)
        self.assertEqual(data[0x26:0x2C], bytes.fromhex("112233445566"))
        self.assertEqual(data[0x2C:0x30], socket.inet_aton(local["ip"]))

    def test_udp_replay_uses_real_listener_on_loopback(self):
        link = DjLink()
        listener = _listener("127.0.0.1", 0)
        self.addCleanup(listener.close)
        self.addCleanup(link.stop)
        port = listener.getsockname()[1]
        with patch("live._listener", return_value=listener):
            link.start("127.0.0.1", announce=False)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
            sender.sendto(packet(), ("127.0.0.1", port))
        deadline = time.monotonic() + 1.5
        while not link.snapshot()[2] and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(link.snapshot()[2], [decode_status(packet())])
        link.stop()
        self.assertEqual(link.snapshot(), ("off", None, []))


class TestLiveMatching(unittest.TestCase):
    def setUp(self):
        self.core = Core()
        self.addCleanup(self.core.link.stop)
        self.collection = Library(None, "Master", [
            track("100", "Anchor", 138), track("101", "Boundary", 142.14, "9A"),
            track("102", "Outside", 142.15), track("103", "Wrong key", 138.1, "12B"),
            track("7", "Unrelated master row", 155),
        ])
        self.addCleanup(self.collection.close)
        self.core.library = self.collection
        self.one = Library(None, "OneLibrary", [track("7", "Anchor", 138)])
        self.legacy = Library(None, "Device Library", [track("7", "Other stick", 128, "3A")])
        self.addCleanup(self.one.close)
        self.addCleanup(self.legacy.close)
        self.core.media = {(3, 3): self.one, (1, 3): self.legacy}

    def status(self, packets, **options):
        decks = [decode_status(data) for data in packets]
        with patch.object(self.core.link, "snapshot", return_value=("listening", None, decks)):
            return self.core.status(options)

    def test_usb_source_id_scoping_and_percent_bounds(self):
        state = self.status([packet(source=3), packet(deck=1, source=1, flags=0)])
        first, second = state["decks"]
        self.assertEqual((first["title"], first["libraryId"]), ("Anchor", "100"))
        self.assertEqual((second["title"], second["libraryId"]), ("Other stick", None))
        self.assertEqual([row["id"] for row in state["matches"]], ["101"])

    def test_usb_track_id_does_not_fall_back_to_master_namespace(self):
        state = self.status([packet(source=4)])
        self.assertIsNone(state["decks"][0]["title"])
        self.assertIsNone(state["decks"][0]["libraryId"])
        self.assertEqual(state["matches"], [])

    def test_explicit_master_source(self):
        without = self.status([packet(source=1, slot=4)])
        self.assertIsNone(without["decks"][0]["title"])
        with_source = self.status([packet(source=1, slot=4)], masterSource=1)
        self.assertEqual(with_source["decks"][0]["libraryId"], "7")

    def test_missing_manual_reference_stays_unavailable(self):
        state = self.status([packet()], deck=4)
        self.assertIsNone(state["anchor"])
        self.assertEqual(state["matches"], [])

    def test_bind_one_library_export_from_disk(self):
        with tempfile.TemporaryDirectory() as temp:
            export = Path(temp) / "exportLibrary.db"
            with closing(sqlite3.connect(export)) as db:
                db.executescript("""
                    CREATE TABLE content (content_id INTEGER PRIMARY KEY, title TEXT, bpmx100 INTEGER,
                        length INTEGER, artist_id_artist INTEGER, path TEXT, key_id INTEGER);
                    CREATE TABLE artist (artist_id INTEGER PRIMARY KEY, name TEXT);
                    CREATE TABLE key (key_id INTEGER PRIMARY KEY, name TEXT);
                    INSERT INTO content VALUES (7, 'Anchor', 13800, 240000, 1, '/Export/Anchor.mp3', 1);
                    INSERT INTO artist VALUES (1, 'Artist');
                    INSERT INTO key VALUES (1, 'Am');
                """)
            before = hashlib.sha256(export.read_bytes()).digest()
            self.assertTrue(self.core.handle("bindMedia", {"path": str(export), "source": 4, "slot": 3}))
            try:
                state = self.status([packet(source=4)])
                self.assertEqual(state["media"][-1]["kind"], "OneLibrary")
                self.assertEqual(state["decks"][0]["key"], "8A")
                self.assertEqual(state["decks"][0]["libraryId"], "100")
                self.assertEqual(hashlib.sha256(export.read_bytes()).digest(), before)
                self.assertEqual(list(Path(temp).iterdir()), [export])
            finally:
                self.core.handle("unbindMedia", {"source": 4, "slot": 3})


if __name__ == "__main__":
    unittest.main()
