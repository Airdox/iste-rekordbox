"""AST-based mutation testing runner for critical backend Filter, Camelot, Sort & Fader modules.

Generates single-site syntactic mutants across:
  - backend/keys.py (Camelot conversion & harmonic circle neighbors)
  - backend/library.py (critical filter, range, sort, recommendation functions)
  - backend/rekordbox_live.py (_crossfader_gain, combine_fader_levels, _progress)
  - backend/main.py (_select_anchor fader disambiguation & hysteresis)

Exits with code 0 when mutation score >= threshold (default 95.0%), else 1.
Writes reports/mutation-python/mutation-report.json.
"""

from __future__ import annotations

import ast
import concurrent.futures
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "reports" / "mutation-python"
REPORT_FILE = REPORT_DIR / "mutation-report.json"

TARGETS: dict[str, set[str] | None] = {
    "backend/keys.py": None,  # entire module
    "backend/library.py": {
        "_parse_range",
        "_key_rank",
        "_rule",
        "_apply_rule",
        "_sort_positions",
        "recommendations",
    },
    "backend/rekordbox_live.py": {
        "_crossfader_gain",
        "combine_fader_levels",
        "_progress",
    },
    "backend/main.py": {
        "_select_anchor",
    },
}

CMP_SWAPS: dict[type[ast.cmpop], type[ast.cmpop]] = {
    ast.LtE: ast.Lt,
    ast.Lt: ast.LtE,
    ast.GtE: ast.Gt,
    ast.Gt: ast.GtE,
    ast.Eq: ast.NotEq,
    ast.NotEq: ast.Eq,
    ast.In: ast.NotIn,
    ast.NotIn: ast.In,
}

BINOP_SWAPS: dict[type[ast.operator], type[ast.operator]] = {
    ast.Add: ast.Sub,
    ast.Sub: ast.Add,
}

BOOLOP_SWAPS: dict[type[ast.boolop], type[ast.boolop]] = {
    ast.And: ast.Or,
    ast.Or: ast.And,
}


def _enclosing_func(parents: dict[ast.AST, ast.AST], node: ast.AST) -> str | None:
    cur = parents.get(node)
    while cur is not None:
        if isinstance(cur, ast.FunctionDef):
            return cur.name
        cur = parents.get(cur)
    return None


def _build_parents(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    return parents


def _collect_mutants(rel_path: str, allowed_funcs: set[str] | None) -> list[dict]:
    src = (ROOT / rel_path).read_text(encoding="utf-8")
    tree = ast.parse(src)
    parents = _build_parents(tree)
    mutants: list[dict] = []

    for idx, node in enumerate(ast.walk(tree)):
        func = _enclosing_func(parents, node)
        if allowed_funcs is not None and func not in allowed_funcs:
            continue
        # Skip docstring constants or type-annotation/constant table declarations outside functions if desired
        desc = None
        if isinstance(node, ast.Compare) and len(node.ops) == 1 and type(node.ops[0]) in CMP_SWAPS:
            # Skip module-level SQLite DDL/boilerplate comparisons
            op_type = type(node.ops[0])
            desc = f"{op_type.__name__} -> {CMP_SWAPS[op_type].__name__}"
        elif isinstance(node, ast.BinOp) and type(node.op) in BINOP_SWAPS and func is not None:
            op_type = type(node.op)
            desc = f"{op_type.__name__} -> {BINOP_SWAPS[op_type].__name__}"
        elif isinstance(node, ast.BoolOp) and type(node.op) in BOOLOP_SWAPS and func is not None:
            op_type = type(node.op)
            desc = f"{op_type.__name__} -> {BOOLOP_SWAPS[op_type].__name__}"
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not) and func is not None:
            desc = "remove unary not"

        if desc is None:
            continue

        mut_tree = copy.deepcopy(tree)
        target = list(ast.walk(mut_tree))[idx]
        if isinstance(target, ast.Compare):
            target.ops[0] = CMP_SWAPS[type(target.ops[0])]()
        elif isinstance(target, ast.BinOp):
            target.op = BINOP_SWAPS[type(target.op)]()
        elif isinstance(target, ast.BoolOp):
            target.op = BOOLOP_SWAPS[type(target.op)]()
        elif isinstance(target, ast.UnaryOp) and isinstance(target.op, ast.Not):
            # Replace `not X` via parent rewrite
            mut_parents = _build_parents(mut_tree)
            parent = mut_parents.get(target)
            replaced = False
            if parent is not None:
                for field, val in ast.iter_fields(parent):
                    if val is target:
                        setattr(parent, field, target.operand)
                        replaced = True
                        break
                    if isinstance(val, list):
                        for li, item in enumerate(val):
                            if item is target:
                                val[li] = target.operand
                                replaced = True
                                break
            if not replaced:
                continue

        ast.fix_missing_locations(mut_tree)
        mut_src = ast.unparse(mut_tree)
        mutants.append({
            "id": f"{rel_path}:{getattr(node, 'lineno', 0)}:{len(mutants) + 1}",
            "file": rel_path,
            "function": func or "<module>",
            "line": getattr(node, "lineno", 0),
            "mutation": desc,
            "source": mut_src,
        })
    return mutants


def _run_mutant(args: tuple[dict, str]) -> dict:
    mutant, python_exe = args
    tmp = Path(tempfile.mkdtemp(prefix="mut_"))
    try:
        shutil.copytree(ROOT / "backend", tmp / "backend")
        shutil.copytree(ROOT / "tests", tmp / "tests")
        if (ROOT / "pyproject.toml").exists():
            shutil.copy2(ROOT / "pyproject.toml", tmp / "pyproject.toml")
        (tmp / mutant["file"]).write_text(mutant["source"], encoding="utf-8")

        env = os.environ.copy()
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PYTHONPATH"] = f"{tmp / 'backend'}{os.pathsep}{tmp}"
        proc = subprocess.run(
            [
                python_exe,
                "-m",
                "pytest",
                "-q",
                "-x",
                "-p",
                "no:cov",
                "-o",
                "addopts=",
                "tests/test_backend_coverage.py",
                "tests/test_rekordbox_playback.py",
            ],
            cwd=str(tmp),
            env=env,
            capture_output=True,
            text=True,
            timeout=25,
        )
        status = "killed" if proc.returncode != 0 else "survived"
        return {
            "id": mutant["id"],
            "file": mutant["file"],
            "function": mutant["function"],
            "line": mutant["line"],
            "mutation": mutant["mutation"],
            "status": status,
        }
    except subprocess.TimeoutExpired:
        return {
            "id": mutant["id"],
            "file": mutant["file"],
            "function": mutant["function"],
            "line": mutant["line"],
            "mutation": mutant["mutation"],
            "status": "timeout",
        }
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    threshold = float(os.environ.get("MUTATION_THRESHOLD", "95.0"))
    python_exe = sys.executable

    # Sanity check: unmutated baseline must pass
    baseline = subprocess.run(
        [
            python_exe,
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cov",
            "-o",
            "addopts=",
            "tests/test_backend_coverage.py",
            "tests/test_rekordbox_playback.py",
        ],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if baseline.returncode != 0:
        print("Baseline tests failed before mutation run:\n", baseline.stdout, baseline.stderr)
        return 1

    all_mutants: list[dict] = []
    for rel_path, funcs in TARGETS.items():
        all_mutants.extend(_collect_mutants(rel_path, funcs))

    print(f"Running {len(all_mutants)} Python AST mutants across {len(TARGETS)} critical backend modules...")
    results: list[dict] = []
    workers = min(4, max(1, (os.cpu_count() or 2) // 2))
    with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as pool:
        for res in pool.map(_run_mutant, [(m, python_exe) for m in all_mutants]):
            results.append(res)

    killed = sum(1 for r in results if r["status"] in ("killed", "timeout"))
    total = len(results)
    score = round((killed / total * 100.0) if total else 100.0, 2)
    survivors = [r for r in results if r["status"] == "survived"]

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "total": total,
        "killed": killed,
        "survived": len(survivors),
        "mutationScore": score,
        "threshold": threshold,
        "passed": score >= threshold,
        "survivors": survivors,
        "results": results,
    }
    REPORT_FILE.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Python Mutation Score: {score:.2f}% ({killed}/{total} killed, threshold {threshold:.1f}%)")
    if survivors:
        print("Surviving mutants (first 15):")
        for s in survivors[:15]:
            print(f"  - {s['id']} ({s['function']}): {s['mutation']}")
    return 0 if score >= threshold else 1


if __name__ == "__main__":
    raise SystemExit(main())
