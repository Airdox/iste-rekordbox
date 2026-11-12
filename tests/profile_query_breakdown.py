import sys, time, json
sys.path.insert(0, "backend")
sys.path.insert(0, "tests")
from generate_synthetic_db import DEFAULT_PATH
from library import Library

lib = Library.load(str(DEFAULT_PATH))
req = {
    'rules': [{'id': 'bpm', 'op': 'gte', 'value': 116.71}, {'id': 'year', 'op': 'lte', 'value': 2025}],
    'sorts': [{'id': 'created', 'desc': False}, {'id': 'label', 'desc': False}, {'id': 'bpm', 'desc': False}, {'id': 'plays', 'desc': True}],
    'facets': False, 'idsOnly': True
}

# Measure step-by-step
conn = lib.conn
order = "created_sort ASC NULLS LAST, label_sort ASC NULLS LAST, bpm ASC NULLS LAST, plays DESC NULLS LAST, id ASC"
where = "WHERE bpm >= ? AND year <= ?"
params = [116.71, 2025]
sql_inner = f"SELECT id FROM tracks {where} ORDER BY {order}"
sql_json = f"SELECT json_group_array(id) FROM ({sql_inner})"

# 1. Just execute the query without fetching all rows
t0 = time.perf_counter()
for _ in range(10):
    cur = conn.cursor()
    cur.row_factory = None
    cur.execute(sql_inner, params)
    cur.fetchone()
t1 = time.perf_counter()
print(f"Execute + 1 fetch: {(t1 - t0)*100:.2f}ms")

# 2. Execute and fetchall with row_factory=None
t0 = time.perf_counter()
for _ in range(10):
    cur = conn.cursor()
    cur.row_factory = None
    cur.execute(sql_inner, params)
    rows = cur.fetchall()
t1 = time.perf_counter()
print(f"Execute + fetchall: {(t1 - t0)*100:.2f}ms")

# 3. json_group_array without json.loads
t0 = time.perf_counter()
for _ in range(10):
    cur = conn.cursor()
    cur.row_factory = None
    cur.execute(sql_json, params)
    raw_str = cur.fetchone()[0]
t1 = time.perf_counter()
print(f"json_group_array fetchone str: {(t1 - t0)*100:.2f}ms")

# 4. json_group_array + json.loads
t0 = time.perf_counter()
for _ in range(10):
    cur = conn.cursor()
    cur.row_factory = None
    cur.execute(sql_json, params)
    parsed = json.loads(cur.fetchone()[0])
t1 = time.perf_counter()
print(f"json_group_array + json.loads: {(t1 - t0)*100:.2f}ms")

