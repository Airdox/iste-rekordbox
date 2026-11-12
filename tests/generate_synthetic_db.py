"""Generate a reproducible Rekordbox-shaped database without any audio files."""

import argparse
import random
import sqlite3
from contextlib import closing
from pathlib import Path
from time import perf_counter

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "build" / "synthetic_test_master.db"
DEFAULT_COUNT = 15_500
GENRES = (
    "Techno", "Hardgroove", "Hypnotic Techno", "Minimal Techno", "Melodic Techno",
    "Deep House", "House", "Progressive House", "Tech House", "Acid House",
    "Electro", "Breakbeat", "Trance", "Psytrance", "Drum & Bass", "Jungle",
    "Ambient", "Downtempo", "UK Garage", "Dubstep", "Dub Techno", "Disco", "Leftfield",
)
TEMPOS = (138, 143, 134, 130, 125, 120, 124, 127, 128, 126, 131, 136, 140, 146, 175, 170, 78, 94, 135, 141, 121, 116, 110)
GENRE_WEIGHTS = (18, 8, 8, 6, 8, 9, 13, 6, 7, 4, 4, 3, 5, 2, 4, 2, 4, 3, 3, 2, 2, 3, 2)
TITLE_BASE = (
    "Afterimage", "Glass Corridor", "Negative Space", "Kinetic Memory", "Nocturnal Bloom",
    "Parallel Lines", "Soft Circuit", "Blue Hour", "Terminal Echo", "Midnight Transit",
    "Pulse Theory", "Static Current", "Hidden Floor", "Aperture", "Fade to Violet",
    "Echoes", "Low Signal", "Far Field", "Slow Arc", "Distant Lights", "Silver Line",
    "Soft Focus", "Dissolve", "Drift", "Passage", "Fault Line", "Phase Delay", "A Second Sun",
)
ARTIST_BASE = (
    "Klara Volt", "Signal Path", "Night Logic", "North Channel", "Isola", "Marin Field",
    "Phase Control", "Studio 23", "Low Orbit", "Kinetic State", "Mara Voss", "Light Motif",
    "Below Ground", "Airform", "Juno North", "Lumen Trace", "Sander Vale", "Laika",
    "Oskar Nacht", "Mira Uhl", "Relay Unit", "Série Noire", "Wellenfänger",
)
ARTISTS = tuple(f"{ARTIST_BASE[index % len(ARTIST_BASE)]} {index // len(ARTIST_BASE) + 1:02}" for index in range(180))
KEYS = tuple(f"{index}{mode}" for mode in "AB" for index in range(1, 13))
LABELS = ("Circuit Archive", "Room Tone", "Subfloor", "Tiefenschärfe", "Réseau", "Night Forms", "Independent")
ALBUMS = ("Night Session", "Daybreak", "Violette", "Two Rooms", "Phase I", "Second Nature", "Fluchtlinien", "Live Takes")
COMMENTS = ("peak-time", "opening set", "vinyl rip", "starker Aufbau", "warm / spacious", "long blend", "", None)

SCHEMA = """
    CREATE TABLE djmdArtist (ID VARCHAR PRIMARY KEY, Name TEXT);
    CREATE TABLE djmdGenre (ID VARCHAR PRIMARY KEY, Name TEXT);
    CREATE TABLE djmdKey (ID VARCHAR PRIMARY KEY, ScaleName TEXT);
    CREATE TABLE djmdAlbum (ID VARCHAR PRIMARY KEY, Name TEXT);
    CREATE TABLE djmdLabel (ID VARCHAR PRIMARY KEY, Name TEXT);
    CREATE TABLE djmdContent (
        ID VARCHAR PRIMARY KEY, Title TEXT, FolderPath TEXT, ReleaseYear INTEGER,
        DateCreated TEXT, StockDate TEXT, Commnt TEXT, Rating INTEGER, Length INTEGER,
        FileSize INTEGER, BitRate INTEGER, SampleRate INTEGER, DJPlayCount INTEGER, BPM INTEGER,
        ArtistID VARCHAR REFERENCES djmdArtist(ID), GenreID VARCHAR REFERENCES djmdGenre(ID),
        KeyID VARCHAR REFERENCES djmdKey(ID), AlbumID VARCHAR REFERENCES djmdAlbum(ID),
        LabelID VARCHAR REFERENCES djmdLabel(ID)
    );
"""


def track_rows(count):
    randomizer = random.Random(13800)
    for index in range(count):
        genre = randomizer.choices(range(len(GENRES)), weights=GENRE_WEIGHTS)[0]
        artist = index % len(ARTISTS)
        year = randomizer.randint(1990, 2026)
        title = TITLE_BASE[(index // len(ARTISTS) + 11 * artist) % len(TITLE_BASE)]
        if index % 17 == 0:
            title += " (Extended Mix)"
        if index % 79 == 0:
            title += " — Nachtflug / Återkomst"
        bpm = max(6000, min(18000, round(randomizer.gauss(TEMPOS[genre], 3.4) * 100)))
        if index % 73 == 0:
            bpm = 13800
        if index % 167 == 0:
            year = 2015
        bpm = {0: 6000, 1: 18000, 2: 13800, 3: 13801, 4: 13799, 5: None, 6: 0}.get(index, bpm)
        year = {0: 1990, 1: 2026, 2: 2015, 3: 2015, 5: None, 6: 0}.get(index, year)
        title = {0: "Àngel & Öl // 東京 (Æther) 🎛", 1: "Übergänge — " + "Klangkörper " * 72,
                 5: None, 6: ""}.get(index, title)
        path = f"E:/Synthetic Music/{ARTISTS[artist]}/Track {index + 1:05}.mp3"
        yield (
            str(index + 1), title, path if index != 5 else None, year,
            f"{year}-01-01" if year else None, f"2026-{1 + index % 11:02}-{1 + index % 28:02}",
            randomizer.choice(COMMENTS), randomizer.randrange(6) if index != 5 else None,
            randomizer.randrange(122, 612) if index != 5 else None, 1024,
            randomizer.choice((192, 256, 320)), randomizer.choice((44100, 48000)),
            randomizer.randrange(200), bpm, str(artist) if index != 5 else None,
            str(genre) if index != 6 else None, str(index % len(KEYS)) if index % 311 != 5 else None,
            str(index % len(ALBUMS)) if index % 159 != 5 else None,
            str(index % len(LABELS)) if index % 151 != 5 else None,
        )


def generate(path, count=DEFAULT_COUNT):
    path = Path(path)
    if count < 15_000:
        raise ValueError("Mindestens 15.000 Tracks sind erforderlich.")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb"):
        pass
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.executescript(SCHEMA)
        for table, values in (("Artist", ARTISTS), ("Genre", GENRES), ("Key", KEYS), ("Album", ALBUMS), ("Label", LABELS)):
            connection.executemany(f"INSERT INTO djmd{table} VALUES (?, ?)", enumerate(values))
        connection.executemany(
            "INSERT INTO djmdContent VALUES (" + ",".join(["?"] * 19) + ")",
            track_rows(count),
        )
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--tracks", type=int, default=DEFAULT_COUNT)
    args = parser.parse_args()
    start = perf_counter()
    try:
        result = generate(args.output, args.tracks)
    except (FileExistsError, ValueError) as error:
        parser.error(str(error))
    size = result.stat().st_size
    print(f"{result} | {args.tracks:,} Tracks | {size / 1_048_576:.2f} MiB | "
          f"{size / args.tracks:.0f} Byte/Track | {perf_counter() - start:.2f} s")
