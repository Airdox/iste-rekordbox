import json
import math
import re
import sqlite3
import unicodedata
from bisect import bisect_left, bisect_right
from functools import lru_cache
from operator import itemgetter
from pathlib import Path
from time import perf_counter

from keys import camelot, compatible
from sources import read_source, resolve_source

TEXT = ("id", "title", "artist", "album", "genre", "label", "key_raw", "path", "created",
        "added", "comment", "analysis", "original_id", "isrc")
INTEGER = ("year", "seconds", "bytes", "bitrate", "sample_rate", "plays")
LIST_FIELDS = ("id", "title", "artist", "genre", "bpm", "key", "rating", "seconds", "year")
DETAIL_FIELDS = (*TEXT, *INTEGER, "rating", "key", "bpm")
TEXT_SORTS = tuple(field for field in TEXT if field != "id")
SEARCH_FIELDS = ("title", "artist", "genre", "album", "label", "comment", "path")
SORTS = {field: f"{field}_sort" for field in TEXT_SORTS}
SORTS.update({field: field for field in ("id", *INTEGER, "bpm", "rating")})
SORTS["key"] = "key_sort"
OPERATORS = {"eq": "=", "gte": ">=", "lte": "<=", "gt": ">", "lt": "<", "neq": "!="}


def folded(value):
    return "".join(char for char in unicodedata.normalize("NFKD", str(value if value is not None else "").casefold())
                   if not unicodedata.combining(char))


def number(value, minimum=0, maximum=1_000_000_000_000):
    try:
        value = float(value)
    except (ValueError, TypeError, OverflowError):
        return None
    return value if math.isfinite(value) and minimum <= value <= maximum else None


def _track(raw):
    track = {field: str(raw[field]).strip() if raw.get(field) is not None else "" for field in TEXT}
    for field in INTEGER:
        value = number(raw.get(field))
        track[field] = int(value) if value is not None else None
    rating = number(raw.get("rating"), 0, 255) or 0
    track["rating"] = round(rating / 51) if rating > 5 else int(rating)
    track["key"] = camelot(track["key_raw"])
    track["bpm"] = number(raw.get("bpm"), 0.01, 655.34)
    return track


def _key_rank(key):
    return int(key[:-1]) * 2 + (key[-1] == "B") if key else None


def _order(request):
    requested = request.get("sorts")
    if not isinstance(requested, list):
        requested = [{"id": request.get("sort", "title"), "desc": request.get("desc", False)}]
    used, order = set(), []
    for stage in requested:
        if not isinstance(stage, dict):
            continue
        field = stage.get("id")
        if not isinstance(field, str) or field not in SORTS or field in used:
            continue
        used.add(field)
        direction = "DESC" if stage.get("desc") is True else "ASC"
        order.append(f"{SORTS[field]} {direction} NULLS LAST")
    if "id" not in used:
        order.append("id ASC")
    return ", ".join(order)


def file_name(path):
    return folded(re.split(r"[/\\]", path)[-1])


def metadata_identity(track):
    return folded(track["title"]).strip(), folded(track["artist"]).strip()


class Library:
    def __init__(self, path, kind, tracks):
        self.path, self.kind = path, kind
        self.conn = sqlite3.connect(":memory:")
        text_indexes = ", ".join(f"{field}_sort INTEGER" for field in TEXT_SORTS)
        self.conn.executescript("""
            PRAGMA temp_store = MEMORY;
            CREATE TABLE tracks (
                id TEXT PRIMARY KEY, genre TEXT, year INTEGER, seconds INTEGER, bytes INTEGER,
                bitrate INTEGER, sample_rate INTEGER, plays INTEGER, rating INTEGER, key TEXT,
                bpm REAL, key_sort INTEGER, """ + text_indexes + """
            );
            CREATE TABLE track_search (id TEXT PRIMARY KEY, content TEXT);
        """)
        normalized = [_track(row) for row in tracks if row.get("id") is not None]
        folded_fields = {field: [folded(track[field]) for track in normalized] for field in TEXT_SORTS}
        self._text_values = {field: sorted(set(values) - {""}) for field, values in folded_fields.items()}
        ranks = {field: {value: index for index, value in enumerate(values)}
                 for field, values in self._text_values.items()}
        # Integer ranks keep comparison keys small even when a title, path or comment is long.
        base = ("id", "genre", *INTEGER, "rating", "key", "bpm")
        columns = (*base, "key_sort", *(SORTS[field] for field in TEXT_SORTS))
        self.conn.executemany(
            f"INSERT INTO tracks ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
            ((*[track[field] for field in base], _key_rank(track["key"]),
              *[ranks[field].get(folded_fields[field][index]) for field in TEXT_SORTS])
             for index, track in enumerate(normalized)),
        )
        self.conn.executemany("INSERT INTO track_search VALUES (?, ?)", (
            (track["id"], " ".join(folded_fields[field][index] for field in SEARCH_FIELDS))
            for index, track in enumerate(normalized)
        ))
        self.conn.executescript("""
            CREATE INDEX track_genre ON tracks(genre);
            CREATE INDEX track_key_bpm ON tracks(key,bpm);
            CREATE INDEX track_artist_year_bpm ON tracks(artist_sort,year,bpm DESC,id);
        """)
        for field, expression in SORTS.items():
            if field in ("id", "original_id", "analysis", "isrc", "key_raw"):
                continue
            self.conn.execute(f"CREATE INDEX track_{field}_ascending ON tracks({expression},id)")
            self.conn.execute(f"CREATE INDEX track_{field}_descending ON tracks({expression} DESC,id)")
        self.conn.execute("ANALYZE")
        self.conn.row_factory = sqlite3.Row
        self.total = len(normalized)
        stats = self.conn.execute("SELECT count(DISTINCT NULLIF(genre,'')), min(bpm), max(bpm), count(key) FROM tracks").fetchone()
        self.genre_count, low, high, self.key_count = stats
        self.bpm_bounds = [math.floor(low), math.ceil(high)] if low is not None else [0, 200]
        self._tracks = {track["id"]: track for track in normalized}
        self._list_rows = {track["id"]: {field: track[field] for field in LIST_FIELDS} for track in normalized}
        self._cached_facet = lru_cache(maxsize=48)(self._facet)
        self._cached_contains = lru_cache(maxsize=64)(self._contains)
        self._projection_fields = ()
        self._projection_rows = {}
        for field in ("genre", "count", "bpm", "key"):
            self._cached_facet(field, "", ())
        self.by_file = {}
        self.by_metadata = {}
        for track in normalized:
            name = file_name(track["path"])
            if name:
                self.by_file.setdefault(name, []).append(track)
            self.by_metadata.setdefault(metadata_identity(track), []).append(track)

    @classmethod
    def load(cls, value=None):
        path = resolve_source(value)
        kind, tracks = read_source(path)
        return cls(path, kind, tracks)

    def close(self):
        self._cached_facet.cache_clear()
        self._cached_contains.cache_clear()
        self.conn.close()

    def info(self):
        return {
            "path": str(self.path) if self.path else None, "kind": self.kind, "total": self.total,
            "genres": self.genre_count, "bpmBounds": self.bpm_bounds, "withKey": self.key_count,
        }

    def _facet(self, field, where, values):
        if field == "count":
            return self.conn.execute(f"SELECT count(*) FROM tracks {where}", values).fetchone()[0]
        if field == "bpm":
            return [dict(row) for row in self.conn.execute(
                f"SELECT CAST(bpm / 5 AS INTEGER) * 5 AS bpm, count(*) AS count FROM tracks {where} "
                "GROUP BY 1 HAVING CAST(bpm / 5 AS INTEGER) IS NOT NULL ORDER BY 1", values
            )]
        return [dict(row) for row in self.conn.execute(
            f"SELECT coalesce({field},'') AS value, count(*) AS count FROM tracks "
            f"{where} GROUP BY {field} ORDER BY count DESC, value COLLATE NOCASE", values
        )]

    def _contains(self, field, needle):
        values = self._text_values[field]
        matches = [index for index, text in enumerate(values) if needle in text]
        column = SORTS[field]
        if not matches:
            return "0", ()
        if len(matches) == len(values):
            return f"{column} IS NOT NULL", ()
        if len(matches) > 128:
            return f"{column} IN (SELECT value FROM json_each(?))", (json.dumps(matches),)
        return f"{column} IN ({','.join('?' for _ in matches)})", tuple(matches)

    def _rule(self, rule):
        if not isinstance(rule, dict):
            return "", ()
        field, operation, value = rule.get("id"), rule.get("op"), rule.get("value")
        if not isinstance(field, str) or field not in SORTS or not isinstance(operation, str):
            return "", ()
        expression = SORTS[field]
        if operation == "empty":
            return f"{expression} IS NULL", ()
        if operation == "contains" and isinstance(value, (str, int, float)) and str(value):
            if field in TEXT_SORTS:
                return self._cached_contains(field, folded(value))
            column = f"lower({field})" if field in ("key", "id") else expression
            return f"instr({column}, ?) > 0", (folded(value),)
        if operation not in OPERATORS:
            return "", ()
        if field in TEXT_SORTS:
            values = self._text_values[field]
            text = folded(str(value).strip()) if value is not None else ""
            if text == "":
                if operation in ("eq", "neq"):
                    return f"{expression} IS {'NOT ' if operation == 'neq' else ''}NULL", ()
                return "", ()
            first, after = bisect_left(values, text), bisect_right(values, text)
            if operation in ("eq", "neq"):
                if first == after:
                    return ("0" if operation == "eq" else f"{expression} IS NOT NULL"), ()
                return f"{expression} {OPERATORS[operation]} ?", (first,)
            if operation in ("gte", "gt"):
                return f"{expression} >= ?", (first if operation == "gte" else after,)
            return f"{expression} < ?", (after if operation == "lte" else first,)
        if field == "key":
            value = _key_rank(camelot(value))
        elif field == "id":
            value = str(value).strip() if value is not None else ""
        else:
            value = number(value)
        return (f"{expression} {OPERATORS[operation]} ?", (value,)) if value is not None else ("0", ())

    def _project(self, track_ids, fields):
        if not fields:
            return [self._list_rows[track_id] for track_id in track_ids]
        if self._projection_fields != fields:
            self._projection_fields = fields
            self._projection_rows = {}
        cache = self._projection_rows
        columns = LIST_FIELDS + fields
        pick = itemgetter(*columns)
        rows = []
        for track_id in track_ids:
            row = cache.get(track_id)
            if row is None:
                row = cache[track_id] = dict(zip(columns, pick(self._tracks[track_id])))
            rows.append(row)
        return rows

    def query(self, request):
        start = perf_counter()
        conditions, params = [], []

        def where():
            return f"WHERE {' AND '.join(conditions)}" if conditions else ""

        def select_many(field, selected):
            if isinstance(selected, list) and selected:
                values = list(dict.fromkeys(value for value in selected if isinstance(value, str)))
                match_missing = field == "key" and "" in values
                if match_missing:
                    values.remove("")
                predicate = []
                if values:
                    predicate.append(f"{field} IN ({','.join('?' for _ in values)})")
                if match_missing:
                    predicate.append(f"{field} IS NULL")
                if predicate:
                    conditions.append(f"({' OR '.join(predicate)})")
                    params.extend(values)

        def bound(field, value, operator):
            value = number(value)
            if value is not None:
                conditions.append(f"{field} {operator} ?")
                params.append(value)

        def facet(field):
            return self._cached_facet(field, where(), tuple(params))

        include_facets = request.get("facets") is not False
        search = folded(str(request.get("search") or "")[:300]).split()
        if search:
            search_terms = " AND ".join("instr(content, ?) > 0" for _ in search)
            conditions.append(f"id IN (SELECT id FROM track_search WHERE {search_terms})")
            params.extend(search)
        if isinstance(request.get("rules"), list):
            for rule in request["rules"]:
                predicate, values = self._rule(rule)
                if predicate:
                    conditions.append(predicate)
                    params.extend(values)
        if isinstance(request.get("excludeId"), str):
            conditions.append("id != ?")
            params.append(request["excludeId"])
        genres = facet("genre") if include_facets else []
        select_many("genre", request.get("genres"))
        genre_count = facet("count") if include_facets else 0
        histogram = facet("bpm") if include_facets else []
        bound("bpm", request.get("bpmMin"), ">=")
        bound("bpm", request.get("bpmMax"), "<=")
        bpm_count = facet("count") if include_facets else 0
        keys = facet("key") if include_facets else []
        select_many("key", request.get("keys"))
        key_count = facet("count") if include_facets else 0
        bound("rating", request.get("rating"), ">=")
        bound("year", request.get("yearMin"), ">=")
        bound("year", request.get("yearMax"), "<=")
        bound("plays", request.get("plays"), ">=")
        ordered_ids = f"SELECT id FROM tracks {where()} ORDER BY {_order(request)}"
        ids = json.loads(self.conn.execute(f"SELECT json_group_array(id) FROM ({ordered_ids})", params).fetchone()[0])
        if request.get("idsOnly") is True:
            rows = ids
        else:
            extra_fields = request.get("fields")
            extra_fields = tuple(dict.fromkeys(
                field for field in extra_fields if field in DETAIL_FIELDS and field not in LIST_FIELDS
            )) if isinstance(extra_fields, list) else ()
            rows = self._project(ids, extra_fields)
        return {"rows": rows, "counts": [genre_count, bpm_count, key_count, len(rows)], "genres": genres,
                "keys": keys, "histogram": histogram, "ms": round((perf_counter() - start) * 1000, 3)}

    def detail(self, track_id):
        track = self._tracks.get(str(track_id))
        return track.copy() if track else None

    def match_media(self, remote):
        if not remote:
            return None
        identity = metadata_identity(remote)
        name = file_name(remote["path"])
        same_file = self.by_file.get(name, []) if name else []
        same_metadata = self.by_metadata.get(identity, []) if all(identity) else []
        file_ids = {row["id"] for row in same_file}
        matching = [track for track in same_metadata if track["id"] in file_ids]
        if len(matching) == 1:
            return matching[0]
        if self.kind == "Master" and (linked := self._tracks.get(remote.get("original_id"))):
            if linked in same_metadata and remote["seconds"] and linked["seconds"] and abs(linked["seconds"] - remote["seconds"]) <= 2:
                return linked
        if len(same_file) == 1 and len(same_metadata) == 1 and same_file[0]["id"] != same_metadata[0]["id"]:
            return None
        for candidates in (matching or same_metadata, same_file if not same_metadata else []):
            valid = [track for track in candidates if remote["seconds"] and track["seconds"]
                     and abs(track["seconds"] - remote["seconds"]) <= 2]
            if len(valid) == 1:
                return valid[0]
        return None

    def recommendations(self, bpm, key, exclude_id, tolerance, harmonic):
        if bpm is None or (harmonic and not key):
            return []
        related = compatible(key)
        statement = "SELECT id FROM tracks WHERE bpm BETWEEN ? AND ? AND id != ?"
        values = [bpm - tolerance, bpm + tolerance, exclude_id or ""]
        if harmonic:
            statement += f" AND key IN ({','.join('?' for _ in related)})"
            values.extend(related)
        rows = [self._list_rows[row[0]].copy() for row in self.conn.execute(statement, values)]
        for row in rows:
            row["delta"] = round(row["bpm"] - bpm, 2)
            row["relation"] = related.get(row["key"], "Tempo")
        rows.sort(key=lambda row: (abs(row["delta"]), row["key"] != key, -row["rating"], row["id"]))
        return rows[:50]


def waveform(library, track):
    if not library.path or not track["analysis"]:
        return []
    from construct import ConstructError
    from pyrekordbox.anlz import AnlzFile

    relative = Path(track["analysis"].lstrip("/\\"))
    parent = library.path.parent
    roots = [parent, parent / "share", parent.parent, parent.parent.parent]
    for root in roots:
        try:
            file = (root / relative).resolve()
            if not file.is_relative_to(root.resolve()) or not file.is_file() or file.stat().st_size > 32_000_000:
                continue
            preview = AnlzFile.parse_file(file).get("PWAV")
            return [int(value) for value in preview[0]] if preview else []
        except (ConstructError, KeyError, OSError, TypeError, ValueError):
            continue
    return []
