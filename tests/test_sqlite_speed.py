import sys, time
sys.path.insert(0, "backend")
sys.path.insert(0, "tests")
from generate_synthetic_db import DEFAULT_PATH
from library import Library
import sqlite3

def test_pragmas(extra_pragmas):
    lib = Library.load(str(DEFAULT_PATH))
    conn = lib.conn
    if extra_pragmas:
        conn.executescript(extra_pragmas)
    order = "created_sort ASC NULLS LAST, label_sort ASC NULLS LAST, bpm ASC NULLS LAST, plays DESC NULLS LAST, id ASC"
    sql = f"SELECT json_group_array(id) FROM (SELECT id FROM tracks ORDER BY {order})"
    
    t0 = time.perf_counter()
    for _ in range(20):
        conn.execute(sql).fetchone()
    t1 = time.perf_counter()
    return (t1 - t0) * 50

print("Default:", test_pragmas(""))
print("cache_size + threads:", test_pragmas("""
    PRAGMA cache_size = -64000;
    PRAGMA threads = 4;
"""))
