import os, sys, time, gc
sys.path.insert(0, "backend")
sys.path.insert(0, "tests")
from generate_synthetic_db import DEFAULT_PATH
from library import Library
from test_combinatorial_stress import Reference, plans, payload, REFERENCE_SELECT
import sqlite3
from contextlib import closing

with closing(sqlite3.connect(DEFAULT_PATH.as_uri() + "?mode=ro", uri=True)) as conn:
    conn.row_factory = sqlite3.Row
    raw = [dict(row) for row in conn.execute(REFERENCE_SELECT)]
reference = Reference(raw)
library = Library.load(str(DEFAULT_PATH))

slow = []
for index, (filters, sorts) in enumerate(plans(reference, 2000), start=1):
    req = payload(filters, sorts, facets=False, idsOnly=True)
    t0 = time.perf_counter()
    res = library.query(req)
    t1 = time.perf_counter()
    dt = (t1 - t0) * 1000
    if dt >= 40:
        slow.append((dt, req))

print(f"Found {len(slow)} queries >= 40ms:")
for dt, req in slow:
    print(f"\nTime in loop: {dt:.2f}ms")
    print(f"Req: {req}")
    # Re-run it 5 times isolated
    re_times = []
    for _ in range(5):
        t0 = time.perf_counter()
        library.query(req)
        t1 = time.perf_counter()
        re_times.append((t1 - t0) * 1000)
    print(f"Re-run isolated times: {[round(x, 2) for x in re_times]} ms")
