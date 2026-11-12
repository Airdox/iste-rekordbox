import sys, time, json
sys.path.insert(0, "backend")
sys.path.insert(0, "tests")
from generate_synthetic_db import DEFAULT_PATH
from library import Library

lib = Library.load(str(DEFAULT_PATH))
req = {'rules': [{'id': 'bpm', 'op': 'gte', 'value': 116.71}, {'id': 'year', 'op': 'lte', 'value': 2025}], 'sorts': [{'id': 'created', 'desc': False}, {'id': 'label', 'desc': False}, {'id': 'bpm', 'desc': False}, {'id': 'plays', 'desc': True}], 'facets': False, 'idsOnly': True}

# Let's inspect the query breakdown
conn = lib.conn
order = "created_sort ASC NULLS LAST, label_sort ASC NULLS LAST, bpm ASC NULLS LAST, plays DESC NULLS LAST, id ASC"
where = "WHERE bpm >= ? AND year <= ?"
params = [116.71, 2025]
sql = f"SELECT id FROM tracks {where} ORDER BY {order}"

print("EXPLAIN QUERY PLAN:")
for row in conn.execute(f"EXPLAIN QUERY PLAN {sql}", params):
    print(dict(row))

# Benchmark 1: json_group_array + json.loads
t0 = time.perf_counter()
for _ in range(10):
    j = json.loads(conn.execute(f"SELECT json_group_array(id) FROM ({sql})", params).fetchone()[0])
t1 = time.perf_counter()
print(f"json_group_array: {(t1 - t0)*100:.2f}ms per query")

# Benchmark 2: cursor fetchall
t0 = time.perf_counter()
for _ in range(10):
    # Use raw cursor or tuple
    cur = conn.cursor()
    cur.execute(sql, params)
    rows = [r[0] for r in cur.fetchall()]
t1 = time.perf_counter()
print(f"fetchall list comp: {(t1 - t0)*100:.2f}ms per query")
