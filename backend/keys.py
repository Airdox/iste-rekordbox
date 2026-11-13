import re

MAJOR = dict(zip("B F# Db Ab Eb Bb F C G D A E".split(), range(1, 13), strict=False))
MINOR = dict(zip("Ab Eb Bb F C G D A E B F# Db".split(), range(1, 13), strict=False))
PITCH_CLASS = dict(zip("C D E F G A B".split(), (0, 2, 4, 5, 7, 9, 11), strict=False))


def pitch_class(note):
    return (PITCH_CLASS[note[0].upper()] + note.count("#") - note.count("b")) % 12


MAJOR_BY_PITCH = {pitch_class(note): index for note, index in MAJOR.items()}
MINOR_BY_PITCH = {pitch_class(note): index for note, index in MINOR.items()}


def camelot(value):
    text = str(value or "").strip().replace("♯", "#").replace("♭", "b")
    wheel = re.fullmatch(r"(1[0-2]|[1-9])\s*([abdm])", text, re.IGNORECASE)
    if wheel:
        index, mode = wheel.groups()
        mode = mode.lower()
        if mode in "ab":
            return f"{index}{mode.upper()}"
        camelot_index = (int(index) + 7) % 12 or 12
        return f"{camelot_index}{'A' if mode == 'm' else 'B'}"
    classical = re.fullmatch(r"([A-Ga-g][#b]?)\s*(M|m|maj(?:or)?|min(?:or)?|dur|moll)?", text)
    if not classical:
        classical = re.fullmatch(r"([A-Ga-g][#b]?)\s*(major|minor|maj|min|dur|moll)", text, re.IGNORECASE)
    if not classical:
        return None
    note, mode = classical.groups()
    minor = mode != "M" and (mode or "").lower() in ("m", "min", "minor", "moll")
    index = (MINOR_BY_PITCH if minor else MAJOR_BY_PITCH)[pitch_class(note)]
    return f"{index}{'A' if minor else 'B'}"


def compatible(key):
    if not key:
        return {}
    index, mode = int(key[:-1]), key[-1]
    relative = "B" if mode == "A" else "A"
    return {key: "Gleiche Tonart", f"{index}{relative}": "Paralleltonart",
            f"{(index - 2) % 12 + 1}{mode}": "Camelot −1",
            f"{index % 12 + 1}{mode}": "Camelot +1"}
