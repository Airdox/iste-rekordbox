import sys, time
sys.path.insert(0, "backend")
sys.path.insert(0, "tests")
from generate_synthetic_db import DEFAULT_PATH
from library import Library

lib = Library.load(str(DEFAULT_PATH))
req = {
    'rules': [{'id': 'album', 'op': 'contains', 'value': 'takes'}, {'id': 'bpm', 'op': 'lte', 'value': 135.07}],
    'sorts': [{'id': 'album', 'desc': False}, {'id': 'title', 'desc': True}, {'id': 'year', 'desc': True}, {'id': 'sample_rate', 'desc': True}],
    'facets': False, 'idsOnly': True
}

# Warm up
res = lib.query(req)

ms = []
for _ in range(50):
    t0 = time.perf_counter()
    res = lib.query(req)
    t1 = time.perf_counter()
    ms.append((t1 - t0) * 1000)

print(f"Count: {len(res['rows'])} | Min: {min(ms):.3f}ms | Mean: {sum(ms)/len(ms):.3f}ms | Max: {max(ms):.3f}ms")
