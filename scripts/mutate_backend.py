"""AST-based mutation testing runner for critical backend Filter, Camelot, Sort & Fader modules.

Generates single-site syntactic mutants across:
  - backend/keys.py (Camelot conversion & harmonic circle neighbors)
  - backend/library.py (critical filter, range, sort, recommendation functions)
  - backend/rekordbox_live.py (_crossfader_gain, combine_fader_levels, _progress)
  - backend/main.py (_select_anchor fader disambiguation & hysteresis)

Exits with code 0 when each module meets the threshold without runner errors or timeouts.
Writes reports/mutation-python/mutation-report.json.
"""

from __future__ import annotations

import argparse
import ast
import concurrent.futures
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from time import perf_counter

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

COVERAGE_TESTS = "tests/test_backend_coverage.py"
PLAYBACK_TESTS = "tests/test_rekordbox_playback.py"
BOUNDARY_TESTS = "tests/test_backend_mutation_contracts.py"
AST_CONTRACT = f"{COVERAGE_TESTS}::test_backend_ast_mutation_killer_suite"
BASELINE_TESTS = (COVERAGE_TESTS, PLAYBACK_TESTS, BOUNDARY_TESTS)
TESTS_BY_MODULE = {
    "backend/keys.py": (
        AST_CONTRACT,
        f"{COVERAGE_TESTS}::test_keys_all_notations_and_empty_compatible",
    ),
    "backend/library.py": (
        AST_CONTRACT,
        f"{COVERAGE_TESTS}::test_library_all_rule_branches_ranges_sorts_projections_and_waveform",
        f"{BOUNDARY_TESTS}::test_filter_ranges_include_both_edges",
        f"{PLAYBACK_TESTS}::test_local_playing_deck_drives_matches_with_effective_bpm",
    ),
    "backend/rekordbox_live.py": (
        AST_CONTRACT,
        f"{COVERAGE_TESTS}::test_rekordbox_live_faders_crossfader_master_and_discover",
        PLAYBACK_TESTS,
    ),
    "backend/main.py": (
        AST_CONTRACT,
        f"{BOUNDARY_TESTS}::test_anchor_filters_paused_and_empty_rekordbox_decks_before_preference",
        f"{BOUNDARY_TESTS}::test_anchor_applies_inclusive_fader_and_exclusive_master_thresholds",
        PLAYBACK_TESTS,
    ),
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
    occurrences: Counter[tuple[str, str, str]] = Counter()

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
        site = (func or "<module>", desc, ast.dump(node))
        occurrences[site] += 1
        fingerprint = hashlib.sha256(repr((*site, occurrences[site])).encode("utf-8")).hexdigest()[:20]
        mutants.append({
            "id": f"{rel_path}:{site[0]}:{fingerprint}",
            "file": rel_path,
            "function": site[0],
            "line": node.lineno,
            "column": node.col_offset + 1,
            "mutation": desc,
            "source": mut_src,
        })
    return mutants


def _run_pytest(cwd: Path, test_paths: tuple[str, ...], report: Path, timeout: float, *, fail_fast=False) -> dict:
    report.unlink(missing_ok=True)
    env = os.environ.copy()
    env.pop("PYTEST_ADDOPTS", None)
    env.pop("PYTEST_PLUGINS", None)
    env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONPATH"] = f"{cwd / 'backend'}{os.pathsep}{cwd}"
    command = [sys.executable, "-m", "pytest", "-q", "-o", "addopts=", f"--junitxml={report}"]
    if fail_fast:
        command.append("-x")
    started = perf_counter()
    try:
        proc = subprocess.run(
            [*command, *test_paths], cwd=cwd, env=env, capture_output=True,
            encoding="utf-8", errors="replace", timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"").decode("utf-8", errors="replace")
        stderr = (exc.stderr or b"").decode("utf-8", errors="replace")
        return {"status": "timeout", "durationMs": (perf_counter() - started) * 1000,
                "diagnostic": f"Timed out after {timeout:g}s.\n" + (stdout + stderr)[-6000:]}
    duration = (perf_counter() - started) * 1000
    try:
        tests = ET.parse(report).findall(".//testcase")
    except (OSError, ET.ParseError):
        tests = []
    failures = [f"{test.attrib['classname']}::{test.attrib['name']}" for test in tests
                if test.find("failure") is not None]
    errors = any(test.find("error") is not None for test in tests)
    ran_test = any(test.find("skipped") is None for test in tests)
    result = {"status": "error", "durationMs": duration, "exitCode": proc.returncode, "failedTests": failures}
    if not errors and ran_test:
        if proc.returncode == 0 and not failures:
            result["status"] = "survived"
        elif proc.returncode == 1 and failures:
            result["status"] = "killed"
    if result["status"] == "error":
        result["diagnostic"] = (proc.stdout + proc.stderr)[-6000:]
    return result


def _run_mutant(mutant: dict, timeout: float) -> dict:
    details = {key: value for key, value in mutant.items() if key != "source"}
    try:
        with tempfile.TemporaryDirectory(prefix="cuepoint-mut-", ignore_cleanup_errors=True) as directory:
            tmp = Path(directory)
            ignore = shutil.ignore_patterns("__pycache__", ".pytest_cache")
            shutil.copytree(ROOT / "backend", tmp / "backend", ignore=ignore)
            shutil.copytree(ROOT / "tests", tmp / "tests", ignore=ignore)
            shutil.copy2(ROOT / "pyproject.toml", tmp / "pyproject.toml")
            (tmp / mutant["file"]).write_text(mutant["source"], encoding="utf-8")
            outcome = _run_pytest(tmp, TESTS_BY_MODULE[mutant["file"]], tmp / "junit.xml", timeout, fail_fast=True)
            return {**details, **outcome}
    except OSError as exc:
        return {**details, "status": "error", "diagnostic": str(exc)}


def _summary(results, threshold):
    counts = Counter(result["status"] for result in results)
    total = len(results)
    score = 100 * counts["killed"] / total if total else 0.0
    return {
        "total": total,
        "killed": counts["killed"],
        "survived": counts["survived"],
        "timeout": counts["timeout"],
        "error": counts["error"],
        "mutationScore": score,
        "passed": total > 0 and score >= threshold and counts["timeout"] == 0 and counts["error"] == 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=min(4, max(1, (os.cpu_count() or 2) // 2)))
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    args = parser.parse_args()
    if args.workers < 1 or not 0 < args.timeout_seconds < float("inf"):
        parser.error("workers and timeout must be positive and finite")
    threshold = float(os.environ.get("MUTATION_THRESHOLD", "95.0"))
    if not 95.0 <= threshold <= 100.0:
        parser.error("MUTATION_THRESHOLD must be between 95 and 100")
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    baseline = _run_pytest(ROOT, BASELINE_TESTS, REPORT_DIR / "baseline-junit.xml", 180.0)
    results = []
    if baseline["status"] == "survived":
        mutants = [mutant for path, functions in TARGETS.items() for mutant in _collect_mutants(path, functions)]
        print(f"Running {len(mutants)} Python AST mutants on {args.workers} workers.", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(_run_mutant, mutant, args.timeout_seconds) for mutant in mutants]
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())
                if len(results) % 20 == 0:
                    print(f"Python AST mutations finished: {len(results)}/{len(mutants)}", flush=True)
        results.sort(key=lambda result: (result["file"], result["line"], result["column"], result["id"]))
    else:
        print(f"Unmutated baseline failed: {baseline}", flush=True)

    per_file = {path: _summary([result for result in results if result["file"] == path], threshold)
                for path in TARGETS}
    report = {
        "schemaVersion": 2,
        **_summary(results, threshold),
        "threshold": threshold,
        "workers": args.workers,
        "timeoutSeconds": args.timeout_seconds,
        "baseline": baseline,
        "testSelection": TESTS_BY_MODULE,
        "perFile": per_file,
        "survivors": [result for result in results if result["status"] == "survived"],
        "results": results,
    }
    report["passed"] = report["passed"] and all(summary["passed"] for summary in per_file.values())
    REPORT_FILE.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    for path, summary in per_file.items():
        print(f"{path}: {summary['mutationScore']:.2f}% ({summary['killed']}/{summary['total']} killed, "
              f"{summary['timeout']} timeout, {summary['error']} error)")
    if report["survivors"]:
        print("Surviving mutants (first 15):")
        for survivor in report["survivors"][:15]:
            print(f"  - {survivor['id']} line {survivor['line']}: {survivor['mutation']}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
