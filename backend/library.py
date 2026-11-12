import json
import math
import operator
import re
import sqlite3
import unicodedata
from bisect import bisect_left, bisect_right
from functools import lru_cache
from operator import itemgetter
from pathlib import Path
from time import perf_counter

import numpy as np

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
NP_OPS = {
    "eq": operator.eq,
    "neq": operator.ne,
    "gte": operator.ge,
    "lte": operator.le,
    "gt": operator.gt,
    "lt": operator.lt,
}


def folded(value):
    return "".join(char for char in unicodedata.normalize("NFKD", str(value if value is not None else "").casefold())
                   if not unicodedata.combining(char))


def number(value, minimum=0, maximum=1_000_000_000_000):
    try:
        value = float(value)
    except (ValueError, TypeError, OverflowError):
        return None
    return value if math.isfinite(value) and minimum <= value <= maximum else None


def _parse_range(value):
    parts = [p.strip() for p in re.split(r"\.\.|;|,|\s+bis\s+|\s+[–—-]\s+", str(value or "").strip())]
    if len(parts) != 2:
        return None
    low, high = number(parts[0]), number(parts[1])
    if low is None or high is None:
        return None
    return (low, high) if low <= high else (high, low)


def _track(raw):
    track = {field: str(raw[field]).strip() if raw.get(field) is not None else "" for field in TEXT}
    for field in INTEGER:
        minimum = 1 if field == "year" else 0
        value = number(raw.get(field), minimum)
        track[field] = int(value) if value is not None else None
    rating = number(raw.get("rating"), 0, 255) or 0
    track["rating"] = round(rating / 51) if rating > 5 else int(rating)
    track["key"] = camelot(track["key_raw"])
    track["bpm"] = number(raw.get("bpm"), 0.01, 655.34)
    return track


def _key_rank(key):
    return int(key[:-1]) * 2 + (key[-1] == "B") if key else None


def file_name(path):
    return folded(re.split(r"[/\\]", path)[-1])


def metadata_identity(track):
    return folded(track["title"]).strip(), folded(track["artist"]).strip()


class Library:
    def __init__(self, path, kind, tracks):
        self.path, self.kind = path, kind
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute("PRAGMA page_size = 32768")
        text_indexes = ", ".join(f"{field}_sort INTEGER" for field in TEXT_SORTS)
        self.conn.executescript("""
            PRAGMA temp_store = MEMORY;
            PRAGMA synchronous = OFF;
            PRAGMA journal_mode = OFF;
            PRAGMA cache_size = -64000;
            CREATE TABLE tracks (
                id TEXT PRIMARY KEY, genre TEXT, year INTEGER, seconds INTEGER, bytes INTEGER,
                bitrate INTEGER, sample_rate INTEGER, plays INTEGER, rating INTEGER, key TEXT,
                bpm REAL, key_sort INTEGER, """ + text_indexes + """
            );
            CREATE TABLE track_search (id TEXT PRIMARY KEY, content TEXT);
        """)
        normalized = sorted((_track(row) for row in tracks if row.get("id") is not None), key=itemgetter("id"))
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
        search_texts = [" ".join(folded_fields[field][index] for field in SEARCH_FIELDS)
                        for index in range(len(normalized))]
        self.conn.executemany("INSERT INTO track_search VALUES (?, ?)", (
            (track["id"], search_texts[index])
            for index, track in enumerate(normalized)
        ))
        self.conn.executescript("""
            CREATE INDEX track_genre ON tracks(genre);
            CREATE INDEX track_genre_bpm ON tracks(genre,bpm,id);
            CREATE INDEX track_key_bpm ON tracks(key,bpm);
            CREATE INDEX track_key_bpm_asc ON tracks(key,bpm,id);
            CREATE INDEX track_key_bpm_desc ON tracks(key,bpm DESC,id);
            CREATE INDEX track_artist_year_bpm ON tracks(artist_sort,year,bpm DESC,id);
            CREATE INDEX track_artist_year_asc ON tracks(artist_sort,year,id);
            CREATE INDEX track_artist_year_desc ON tracks(artist_sort,year DESC,id);
        """)
        for field, expression in SORTS.items():
            if field in ("id", "original_id", "analysis", "key_raw"):
                continue
            self.conn.execute(f"CREATE INDEX track_{field}_ascending ON tracks({expression},id)")
            self.conn.execute(f"CREATE INDEX track_{field}_descending ON tracks({expression} DESC,id)")
        self.conn.execute("ANALYZE")
        self.conn.row_factory = sqlite3.Row
        self.total = len(normalized)
        stats = self.conn.execute(
            "SELECT count(DISTINCT NULLIF(genre,'')), min(bpm), max(bpm), count(key) FROM tracks"
        ).fetchone()
        self.genre_count, low, high, self.key_count = stats
        self.bpm_bounds = [math.floor(low), math.ceil(high)] if low is not None else [0, 200]
        self._tracks = {track["id"]: track for track in normalized}
        self._list_rows = {track["id"]: {field: track[field] for field in LIST_FIELDS} for track in normalized}
        self._cached_facet = lru_cache(maxsize=48)(self._facet)
        self._cached_contains = lru_cache(maxsize=64)(self._contains)
        self._cached_contains_lut = lru_cache(maxsize=128)(self._contains_lut)
        self._init_index(normalized, folded_fields, ranks, search_texts)
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

    def _init_index(self, normalized, folded_fields, ranks, search_texts):
        n = len(normalized)
        self._ids = [track["id"] for track in normalized]
        self._id_pos = {track_id: index for index, track_id in enumerate(self._ids)}
        self._pos = np.arange(n, dtype=np.int32)
        self._search_texts = search_texts
        self._sort_asc = {}
        self._sort_desc = {}
        self._text_null = {}
        for field in TEXT_SORTS:
            m = len(self._text_values[field])
            self._text_null[field] = m
            asc = np.array([ranks[field].get(folded_fields[field][i], m) for i in range(n)], dtype=np.int32)
            self._sort_asc[field] = asc
            self._sort_desc[field] = np.where(asc < m, (m - 1) - asc, m).astype(np.int32)
        key_asc = np.array([r if (r := _key_rank(t["key"])) is not None else 26 for t in normalized], dtype=np.int32)
        self._sort_asc["key"] = key_asc
        self._sort_desc["key"] = np.where(key_asc < 26, 25 - key_asc, 26).astype(np.int32)
        raw_keys = [t["key"] or "" for t in normalized]
        self._key_masks = {k: np.array([v == k for v in raw_keys], dtype=bool) for k in set(raw_keys)}
        genres = sorted({t["genre"] for t in normalized})
        self._genre_vocab = {g: i for i, g in enumerate(genres)}
        self._genre_idx = np.array([self._genre_vocab[t["genre"]] for t in normalized], dtype=np.int32)
        self._num_raw = {}
        self._num_valid = {}
        for field in (*INTEGER, "rating", "bpm"):
            vals = [t[field] for t in normalized]
            self._num_valid[field] = np.array([v is not None for v in vals], dtype=bool)
            dtype = np.float64 if field == "bpm" else np.int64
            self._num_raw[field] = np.array([v if v is not None else 0 for v in vals], dtype=dtype)
            uniq = sorted({v for v in vals if v is not None})
            m = len(uniq)
            rmap = {v: i for i, v in enumerate(uniq)}
            asc = np.array([rmap[v] if v is not None else m for v in vals], dtype=np.int32)
            self._sort_asc[field] = asc
            self._sort_desc[field] = np.where(asc < m, (m - 1) - asc, m).astype(np.int32)

    @classmethod
    def load(cls, value=None):
        path = resolve_source(value)
        kind, tracks = read_source(path)
        return cls(path, kind, tracks)

    def close(self):
        self._cached_facet.cache_clear()
        self._cached_contains.cache_clear()
        self._cached_contains_lut.cache_clear()
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

    def _contains_lut(self, field, needle):
        values = self._text_values[field]
        matches = [index for index, text in enumerate(values) if needle in text]
        if not matches:
            return False
        if len(matches) == len(values):
            return True
        lut = np.zeros(len(values) + 1, dtype=bool)
        lut[matches] = True
        return lut

    def _rule(self, rule):
        if not isinstance(rule, dict):
            return "", ()
        field, operation, value = rule.get("id"), rule.get("op"), rule.get("value")
        if not isinstance(field, str) or field not in SORTS or not isinstance(operation, str):
            return "", ()
        expression = SORTS[field]
        if operation == "empty":
            return f"{expression} IS NULL", ()
        if operation == "range":
            if field in (*INTEGER, "rating", "bpm"):
                bounds = _parse_range(value)
                return (f"{expression} BETWEEN ? AND ?", bounds) if bounds else ("0", ())
            parts = [p.strip() for p in re.split(r"\.\.|;|,|\s+bis\s+|\s+[–—-]\s+", str(value or "").strip())]
            if len(parts) != 2:
                return "0", ()
            if field == "key":
                lo, hi = _key_rank(camelot(parts[0])), _key_rank(camelot(parts[1]))
                if lo is None or hi is None:
                    return "0", ()
                return f"{expression} BETWEEN ? AND ?", (min(lo, hi), max(lo, hi))
            if field == "id":
                lo, hi = min(parts), max(parts)
                return f"{expression} BETWEEN ? AND ?", (lo, hi)
            values = self._text_values[field]
            lo_t, hi_t = folded(parts[0]), folded(parts[1])
            if lo_t > hi_t:
                lo_t, hi_t = hi_t, lo_t
            return f"{expression} >= ? AND {expression} < ?", (bisect_left(values, lo_t), bisect_right(values, hi_t))
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

    def _apply_rule(self, mask, rule):
        if not isinstance(rule, dict):
            return True
        field, operation, value = rule.get("id"), rule.get("op"), rule.get("value")
        if not isinstance(field, str) or field not in SORTS or not isinstance(operation, str):
            return True
        if operation == "empty":
            if field in TEXT_SORTS:
                mask &= (self._sort_asc[field] == self._text_null[field])
            elif field == "key":
                mask &= (self._sort_asc["key"] == 26)
            elif field == "id":
                return False
            else:
                mask &= ~self._num_valid[field]
            return True
        if operation == "range":
            if field in (*INTEGER, "rating", "bpm"):
                bounds = _parse_range(value)
                if not bounds:
                    return False
                lo, hi = bounds
                raw = self._num_raw[field]
                mask &= (raw >= lo) & (raw <= hi) & self._num_valid[field]
                return True
            parts = [p.strip() for p in re.split(r"\.\.|;|,|\s+bis\s+|\s+[–—-]\s+", str(value or "").strip())]
            if len(parts) != 2:
                return False
            if field == "key":
                lo, hi = _key_rank(camelot(parts[0])), _key_rank(camelot(parts[1]))
                if lo is None or hi is None:
                    return False
                asc = self._sort_asc["key"]
                mask &= (asc >= min(lo, hi)) & (asc <= max(lo, hi)) & (asc < 26)
                return True
            if field == "id":
                lo_i = bisect_left(self._ids, min(parts))
                hi_i = bisect_right(self._ids, max(parts))
                mask &= (self._pos >= lo_i) & (self._pos < hi_i)
                return True
            values = self._text_values[field]
            lo_t, hi_t = folded(parts[0]), folded(parts[1])
            if lo_t > hi_t:
                lo_t, hi_t = hi_t, lo_t
            asc = self._sort_asc[field]
            mask &= (asc >= bisect_left(values, lo_t)) & (asc < bisect_right(values, hi_t))
            return True
        if operation == "contains" and isinstance(value, (str, int, float)) and str(value):
            if field in TEXT_SORTS:
                lut = self._cached_contains_lut(field, folded(value))
                if lut is False:
                    return False
                if lut is True:
                    mask &= (self._sort_asc[field] < self._text_null[field])
                else:
                    mask &= lut[self._sort_asc[field]]
                return True
            column = f"lower({field})" if field in ("key", "id") else SORTS[field]
            rows = self.conn.execute(f"SELECT id FROM tracks WHERE instr({column}, ?) > 0", (folded(value),)).fetchall()
            if not rows:
                return False
            sub = np.zeros(self.total, dtype=bool)
            sub[[self._id_pos[r[0]] for r in rows]] = True
            mask &= sub
            return True
        if operation not in OPERATORS:
            return True
        op_fn = NP_OPS[operation]
        if field in TEXT_SORTS:
            values = self._text_values[field]
            m = self._text_null[field]
            asc = self._sort_asc[field]
            text = folded(str(value).strip()) if value is not None else ""
            if text == "":
                if operation == "eq":
                    mask &= (asc == m)
                elif operation == "neq":
                    mask &= (asc < m)
                return True
            first, after = bisect_left(values, text), bisect_right(values, text)
            if operation in ("eq", "neq"):
                if first == after:
                    if operation == "eq":
                        return False
                    mask &= (asc < m)
                elif operation == "eq":
                    mask &= (asc == first)
                else:
                    mask &= (asc != first) & (asc < m)
                return True
            if operation in ("gte", "gt"):
                t = first if operation == "gte" else after
                mask &= (asc >= t) & (asc < m)
                return True
            t = after if operation == "lte" else first
            mask &= (asc < t)
            return True
        if field == "key":
            rank = _key_rank(camelot(value))
            if rank is None:
                return False
            asc = self._sort_asc["key"]
            mask &= op_fn(asc, rank) & (asc < 26)
            return True
        if field == "id":
            text = str(value).strip() if value is not None else ""
            first, after = bisect_left(self._ids, text), bisect_right(self._ids, text)
            if operation == "eq":
                if first == after:
                    return False
                mask &= (self._pos == first)
            elif operation == "neq":
                if first != after:
                    mask &= (self._pos != first)
            elif operation == "gte":
                mask &= (self._pos >= first)
            elif operation == "gt":
                mask &= (self._pos >= after)
            elif operation == "lte":
                mask &= (self._pos < after)
            else:
                mask &= (self._pos < first)
            return True
        val = number(value)
        if val is None:
            return False
        mask &= op_fn(self._num_raw[field], val) & self._num_valid[field]
        return True

    def _sort_positions(self, idx, request):
        requested = request.get("sorts")
        if not isinstance(requested, list):
            requested = [{"id": request.get("sort", "title"), "desc": request.get("desc", False)}]
        used, stages = set(), []
        for stage in requested:
            if not isinstance(stage, dict):
                continue
            field = stage.get("id") or stage.get("field")
            if not isinstance(field, str) or field not in SORTS or field in used:
                continue
            used.add(field)
            stages.append((field, stage.get("desc") is True or stage.get("dir") == "desc"))
        if not stages:
            return idx
        if len(stages) == 1:
            field, desc = stages[0]
            if field == "id":
                return idx[::-1] if desc else idx
            col = self._sort_desc[field] if desc else self._sort_asc[field]
            return idx[np.argsort(col[idx], kind="stable")]
        keys = [] if "id" in used else [idx]
        for field, desc in reversed(stages):
            if field == "id":
                keys.append(-idx if desc else idx)
            else:
                col = self._sort_desc[field] if desc else self._sort_asc[field]
                keys.append(col[idx])
        return idx[np.lexsort(tuple(keys))]

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
                row = cache[track_id] = dict(zip(columns, pick(self._tracks[track_id]), strict=False))
            rows.append(row)
        return rows

    def query(self, request):
        start = perf_counter()
        include_facets = request.get("facets") is not False
        if self.total == 0:
            return {"rows": [], "counts": [0, 0, 0, 0], "genres": [], "keys": [], "histogram": [],
                    "ms": round((perf_counter() - start) * 1000, 3)}
        mask = np.ones(self.total, dtype=bool)
        possible = True
        conditions, params = [], []

        def where():
            return f"WHERE {' AND '.join(conditions)}" if conditions else ""

        def select_many(field, selected):
            nonlocal mask, possible
            if isinstance(selected, list) and selected:
                values = list(dict.fromkeys(value for value in selected if isinstance(value, str)))
                if not values:
                    return
                if include_facets:
                    sql_vals = list(values)
                    match_missing = field == "key" and "" in sql_vals
                    if match_missing:
                        sql_vals.remove("")
                    predicate = []
                    if sql_vals:
                        predicate.append(f"{field} IN ({','.join('?' for _ in sql_vals)})")
                    if match_missing:
                        predicate.append(f"{field} IS NULL")
                    if predicate:
                        conditions.append(f"({' OR '.join(predicate)})")
                        params.extend(sql_vals)
                if not possible:
                    return
                if field == "genre":
                    g_ids = [self._genre_vocab[v] for v in values if v in self._genre_vocab]
                    if not g_ids:
                        possible = False
                    elif len(g_ids) == 1:
                        mask &= (self._genre_idx == g_ids[0])
                    else:
                        lut = np.zeros(len(self._genre_vocab), dtype=bool)
                        lut[g_ids] = True
                        mask &= lut[self._genre_idx]
                else:
                    sub = np.zeros(self.total, dtype=bool)
                    for v in values:
                        km = self._key_masks.get(v)
                        if km is not None:
                            sub |= km
                    mask &= sub

        def bound(field, value, op_name):
            nonlocal mask, possible
            value = number(value)
            if value is not None:
                if include_facets:
                    conditions.append(f"{field} {OPERATORS[op_name]} ?")
                    params.append(value)
                if possible:
                    mask &= NP_OPS[op_name](self._num_raw[field], value) & self._num_valid[field]

        def facet(field):
            return self._cached_facet(field, where(), tuple(params))

        search = folded(str(request.get("search") or "")[:300]).split()
        if search:
            if include_facets:
                search_terms = " AND ".join("instr(content, ?) > 0" for _ in search)
                conditions.append(f"id IN (SELECT id FROM track_search WHERE {search_terms})")
                params.extend(search)
            if possible:
                mask &= np.fromiter(
                    (all(term in text for term in search) for text in self._search_texts),
                    dtype=bool, count=self.total,
                )
        if isinstance(request.get("rules"), list):
            for rule in request["rules"]:
                if include_facets:
                    predicate, values = self._rule(rule)
                    if predicate:
                        conditions.append(predicate)
                        params.extend(values)
                if possible and not self._apply_rule(mask, rule):
                    possible = False
        if isinstance(request.get("groups"), list) and request["groups"]:
            group_logic = "OR" if request.get("groupLogic") == "OR" else "AND"
            group_masks, group_sqls, group_params = [], [], []
            for group in request["groups"]:
                if not isinstance(group, dict) or not isinstance(group.get("rules"), list):
                    continue
                active_rules = [
                    rule
                    for rule in group["rules"]
                    if isinstance(rule, dict)
                    and (
                        rule.get("op") == "empty"
                        or str(rule.get("value") if rule.get("value") is not None else "").strip() != ""
                    )
                ]
                if not active_rules:
                    continue
                mode = "OR" if group.get("mode") == "OR" else "AND"
                g_mask = np.ones(self.total, dtype=bool) if mode == "AND" else np.zeros(self.total, dtype=bool)
                r_sqls = []
                for rule in active_rules:
                    if include_facets:
                        predicate, values = self._rule(rule)
                        if predicate:
                            r_sqls.append(f"({predicate})")
                            group_params.extend(values)
                    if mode == "AND":
                        if not self._apply_rule(g_mask, rule):
                            g_mask.fill(False)
                    else:
                        r_mask = np.ones(self.total, dtype=bool)
                        if self._apply_rule(r_mask, rule):
                            g_mask |= r_mask
                group_masks.append(g_mask)
                if include_facets and r_sqls:
                    group_sqls.append(f"({' OR '.join(r_sqls) if mode == 'OR' else ' AND '.join(r_sqls)})")
            if group_masks:
                if group_logic == "AND":
                    for g_mask in group_masks:
                        mask &= g_mask
                else:
                    combined = np.zeros(self.total, dtype=bool)
                    for g_mask in group_masks:
                        combined |= g_mask
                    mask &= combined
            if include_facets and group_sqls:
                conditions.append(f"({' OR '.join(group_sqls) if group_logic == 'OR' else ' AND '.join(group_sqls)})")
                params.extend(group_params)
        exclude_id = request.get("excludeId")
        if isinstance(exclude_id, str):
            if include_facets:
                conditions.append("id != ?")
                params.append(exclude_id)
            if possible:
                pos = self._id_pos.get(exclude_id)
                if pos is not None:
                    mask[pos] = False
        genres = facet("genre") if include_facets else []
        select_many("genre", request.get("genres"))
        genre_count = facet("count") if include_facets else 0
        histogram = facet("bpm") if include_facets else []
        bound("bpm", request.get("bpmMin"), "gte")
        bound("bpm", request.get("bpmMax"), "lte")
        bpm_count = facet("count") if include_facets else 0
        keys = facet("key") if include_facets else []
        select_many("key", request.get("keys"))
        key_count = facet("count") if include_facets else 0
        bound("rating", request.get("rating"), "gte")
        bound("year", request.get("yearMin"), "gte")
        bound("year", request.get("yearMax"), "lte")
        bound("plays", request.get("plays"), "gte")
        if possible:
            idx = np.flatnonzero(mask)
            if idx.size:
                idx = self._sort_positions(idx, request)
                ids = [self._ids[i] for i in idx.tolist()]
            else:
                ids = []
        else:
            ids = []
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
            if (
                linked in same_metadata
                and remote["seconds"]
                and linked["seconds"]
                and abs(linked["seconds"] - remote["seconds"]) <= 2
            ):
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
