import argparse
import random
import sqlite3
from pathlib import Path

GENRES = ("Techno", "Melodic Techno", "Deep House", "House", "Minimal", "Trance",
          "Progressive House", "Electro", "Breakbeat", "Ambient", "Drum & Bass")
ARTISTS = ("Klara Volt", "Signal Path", "Night Logic", "North Channel", "Isola",
           "Marin Field", "Phase Control", "Studio 23", "Low Orbit", "Kinetic State")
TITLES = ("Afterimage", "Glass Corridor", "Negative Space", "Kinetic Memory", "Nocturnal Bloom",
          "Parallel Lines", "Soft Circuit", "Blue Hour", "Terminal Echo", "Midnight Transit",
          "Pulse Theory", "Static Current", "Hidden Floor", "Aperture", "Fade to Violet")


def demo_tracks(count=15_500):
    rng = random.Random(13800)  # noqa: S311
    tempo = (137, 126, 119, 124, 128, 141, 125, 135, 132, 94, 174)
    for index in range(count):
        genre = rng.choices(range(len(GENRES)), [23, 16, 13, 13, 9, 6, 6, 4, 4, 3, 3])[0]
        title = TITLES[index % len(TITLES)]
        if index >= len(TITLES):
            title += f" · {index // len(TITLES) + 1:03}"
        yield {
            "id": str(index + 1), "title": title, "artist": ARTISTS[index % len(ARTISTS)],
            "genre": GENRES[genre], "bpm": round(rng.gauss(tempo[genre], 4.2), 2),
            "key_raw": f"{rng.randrange(1, 13)}{rng.choice('AB')}", "rating": rng.randrange(6),
            "year": rng.randrange(1997, 2027), "seconds": rng.randrange(180, 520),
            "plays": rng.randrange(120), "label": "Circuit Archive", "album": "Night Session",
            "added": f"2026-10-{rng.randrange(1, 32):02}", "bitrate": 320, "sample_rate": 44100,
            "path": f"/Music/Cuepoint Demo/{index + 1}.mp3", "bytes": rng.randrange(6_000_000, 23_000_000),
        }


def generate(path, count):
    with path.open("xb"):
        pass
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            CREATE TABLE djmdArtist (ID TEXT PRIMARY KEY, Name TEXT);
            CREATE TABLE djmdGenre (ID TEXT PRIMARY KEY, Name TEXT);
            CREATE TABLE djmdKey (ID TEXT PRIMARY KEY, ScaleName TEXT);
            CREATE TABLE djmdAlbum (ID TEXT PRIMARY KEY, Name TEXT);
            CREATE TABLE djmdLabel (ID TEXT PRIMARY KEY, Name TEXT);
            CREATE TABLE djmdContent (
                ID TEXT PRIMARY KEY, Title TEXT, FolderPath TEXT, ReleaseYear INTEGER,
                DateCreated TEXT, StockDate TEXT, Commnt TEXT, Rating INTEGER, Length INTEGER,
                FileSize INTEGER, BitRate INTEGER, SampleRate INTEGER, DJPlayCount INTEGER, BPM INTEGER,
                ArtistID TEXT, GenreID TEXT, KeyID TEXT, AlbumID TEXT, LabelID TEXT
            );
        """)
        table_inserts = (
            ("INSERT INTO djmdArtist VALUES (?,?)", ARTISTS),
            ("INSERT INTO djmdGenre VALUES (?,?)", GENRES),
            ("INSERT INTO djmdKey VALUES (?,?)", [f"{i}{mode}" for i in range(1, 13) for mode in "AB"]),
            ("INSERT INTO djmdAlbum VALUES (?,?)", ("Night Session",)),
            ("INSERT INTO djmdLabel VALUES (?,?)", ("Circuit Archive",)),
        )
        for sql, values in table_inserts:
            conn.executemany(sql, [(value, value) for value in values])
        conn.executemany("INSERT INTO djmdContent VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            (track["id"], track["title"], track["path"], track["year"], None, track["added"], "",
             track["rating"] * 51, track["seconds"], track["bytes"], track["bitrate"], track["sample_rate"],
             track["plays"], round(track["bpm"] * 100), track["artist"], track["genre"], track["key_raw"],
             track["album"], track["label"])
            for track in demo_tracks(count)
        ))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Erstellt eine neue synthetische Rekordbox-Testbibliothek.")
    parser.add_argument("output", type=Path)
    parser.add_argument("--tracks", type=int, default=15_500)
    arguments = parser.parse_args()
    if arguments.tracks < 1:
        parser.error("--tracks muss positiv sein")
    generate(arguments.output, arguments.tracks)
