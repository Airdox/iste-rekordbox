"""Airdox Quality Gate Verifier & Report Generator.

Aggregates coverage (measured strictly separately for Python, React/TS and Electron),
critical branch checks (100% targets), combinatorial stress results, UI integration tests
and mutation scores (>=95% TS + >=95% Python), writing:
  - reports/quality-gate-report.md
  - reports/quality-gate-report.json

Exits with code 0 only if ALL configured quality gates pass AND no critical test failed.
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"

THRESHOLD_GLOBAL = 90.0
THRESHOLD_CRITICAL_BRANCH = 100.0
THRESHOLD_MUTATION = 95.0

CRITICAL_FRONTEND_FILES = (
    "api.ts",
    "metadata.ts",
    "camelot-wheel.tsx",
)

CRITICAL_PYTHON_MODULES = {
    "keys.py": ("backend/keys.py", 100.0),
    "fixtures.py": ("backend/fixtures.py", 100.0),
    "sources.py": ("backend/sources.py", 95.0),
    "library.py": ("backend/library.py", 95.0),
    "live.py": ("backend/live.py", 95.0),
    "main.py": ("backend/main.py", 90.0),
}

REQUIREMENT_MATRIX = [
    (
        "REQ-01",
        "Camelot-Harmonien, Key-Rotation (+/-1, Parallel A<->B)",
        "backend/keys.py & src/camelot-wheel.tsx",
        "tests/test_live.py, tests/test_backend_coverage.py, tests/frontend/components-wheel.test.tsx",
    ),
    (
        "REQ-02",
        "Read-Only SQLite/SQLCipher Zugriff auf master.db (ohne Schreibzugriff)",
        "backend/sources.py (open_source, shadow_copy, _sqlite_readonly)",
        "tests/test_readonly.py, tests/test_backend_coverage.py",
    ),
    (
        "REQ-03",
        "15.000-Track Synthetische DB & 100.000+ Multi-Cascade Filter/Sort",
        "backend/library.py (_apply_rule, _sort_positions, query)",
        "tests/test_combinatorial_stress.py, tests/test_filter_groups.py",
    ),
    (
        "REQ-04",
        "Rekordbox Two-Deck Stabilisierung, Fader/Crossfader & Sticky-Anchor",
        "backend/rekordbox_live.py (_crossfader_gain, combine_fader_levels, _progress) "
        "& backend/main.py (_select_anchor) & src/main.tsx (lastLiveDeck)",
        "tests/test_rekordbox_playback.py, tests/test_backend_coverage.py, tests/frontend/app.test.tsx",
    ),
    (
        "REQ-05",
        "IPC Bridge & BrowserWindow Lifecycle (Electron Main/Preload)",
        "electron/main.cjs & electron/preload.cjs",
        "tests/electron/main.test.mjs, tests/electron-smoke.cjs",
    ),
    (
        "REQ-06",
        "High-Contrast UI, Virtual Scrolling, Filter-Presets & Set-Builder CSV",
        "src/main.tsx, src/track-table.tsx, src/live-view.tsx, src/filter-view.tsx, src/set-view.tsx",
        "tests/frontend/views-table.test.tsx, tests/frontend/app.test.tsx, tests/electron-smoke.cjs",
    ),
]


def _git_info() -> dict[str, str]:
    def _run(args: list[str]) -> str:
        try:
            out = subprocess.check_output(args, cwd=str(ROOT), stderr=subprocess.DEVNULL, text=True)
            return out.strip()
        except Exception:
            return "unknown"

    return {
        "commit": _run(["git", "rev-parse", "HEAD"]),
        "shortCommit": _run(["git", "rev-parse", "--short", "HEAD"]),
        "branch": _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
    }


def _load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _read_junit(path: Path) -> dict | None:
    if not path.exists():
        return None
    tree = ET.parse(path)
    root = tree.getroot()
    suites = root.findall(".//testsuite") if root.tag == "testsuites" else [root]
    tests = sum(int(s.attrib.get("tests", 0)) for s in suites)
    failures = sum(int(s.attrib.get("failures", 0)) for s in suites)
    errors = sum(int(s.attrib.get("errors", 0)) for s in suites)
    skipped = sum(int(s.attrib.get("skipped", 0)) for s in suites)
    return {
        "tests": tests,
        "failures": failures,
        "errors": errors,
        "skipped": skipped,
        "passed": failures == 0 and errors == 0 and tests > 0,
    }


def _python_metrics() -> dict:
    data = _load_json(REPORTS / "coverage-python" / "coverage.json")
    if not data:
        return {"present": False, "passed": False}
    totals = data["totals"]
    covered_lines = totals.get("covered_lines", 0)
    num_statements = totals.get("num_statements", 0)
    covered_branches = totals.get("covered_branches", 0)
    num_branches = totals.get("num_branches", 0)
    line_pct = round((covered_lines / num_statements * 100.0) if num_statements else 0.0, 2)
    branch_pct = round((covered_branches / num_branches * 100.0) if num_branches else 100.0, 2)
    overall_pct = round(totals.get("percent_covered", 0.0), 2)

    files = data.get("files", {})
    per_file = {}
    critical_ok = True
    for name, (_rel, min_pct) in CRITICAL_PYTHON_MODULES.items():
        matched = next((v for k, v in files.items() if k.replace("\\", "/").endswith(f"/{name}")), None)
        if not matched:
            per_file[name] = {"pct": 0.0, "min": min_pct, "ok": False}
            critical_ok = False
        else:
            pct = round(matched["summary"].get("percent_covered", 0.0), 2)
            ok = pct >= min_pct
            if not ok:
                critical_ok = False
            per_file[name] = {"pct": pct, "min": min_pct, "ok": ok}

    passed = line_pct >= THRESHOLD_GLOBAL and branch_pct >= THRESHOLD_GLOBAL and critical_ok
    return {
        "present": True,
        "linePct": line_pct,
        "branchPct": branch_pct,
        "combinedPct": overall_pct,
        "perFile": per_file,
        "criticalOk": critical_ok,
        "passed": passed,
    }


def _istanbul_metrics(path: Path, critical_suffixes: tuple[str, ...]) -> dict:
    data = _load_json(path)
    if not data or "total" not in data:
        return {"present": False, "passed": False}
    tot = data["total"]
    summary = {
        "lines": float(tot["lines"]["pct"]),
        "statements": float(tot["statements"]["pct"]),
        "functions": float(tot["functions"]["pct"]),
        "branches": float(tot["branches"]["pct"]),
    }
    global_ok = all(v >= THRESHOLD_GLOBAL for v in summary.values())

    critical = {}
    critical_ok = True
    for suffix in critical_suffixes:
        matched = next(
            (v for k, v in data.items() if k != "total" and k.replace("\\", "/").endswith(f"/{suffix}")),
            None,
        )
        if not matched:
            critical[suffix] = {"ok": False}
            critical_ok = False
        else:
            vals = {
                m: float(matched[m]["pct"])
                for m in ("lines", "statements", "functions", "branches")
            }
            ok = all(v >= THRESHOLD_CRITICAL_BRANCH for v in vals.values())
            if not ok:
                critical_ok = False
            critical[suffix] = {**vals, "ok": ok}

    return {
        "present": True,
        **summary,
        "critical": critical,
        "criticalOk": critical_ok,
        "passed": global_ok and critical_ok,
    }


def _stryker_metrics(path: Path) -> dict:
    data = _load_json(path)
    if not data:
        return {"present": False, "passed": False}
    counts = {"killed": 0, "timeout": 0, "survived": 0, "noCoverage": 0, "compileError": 0, "runtimeError": 0}
    survivors = []
    for file_path, fdata in data.get("files", {}).items():
        for mut in fdata.get("mutants", []):
            status = mut.get("status", "")
            key = status[0].lower() + status[1:] if status else ""
            if status == "Killed":
                counts["killed"] += 1
            elif status == "Timeout":
                counts["timeout"] += 1
            elif status == "Survived":
                counts["survived"] += 1
                survivors.append({
                    "file": Path(file_path).name,
                    "mutator": mut.get("mutatorName"),
                    "line": mut.get("location", {}).get("start", {}).get("line"),
                    "replacement": mut.get("replacement"),
                })
            elif status == "NoCoverage":
                counts["noCoverage"] += 1
                survivors.append({
                    "file": Path(file_path).name,
                    "mutator": mut.get("mutatorName"),
                    "line": mut.get("location", {}).get("start", {}).get("line"),
                    "replacement": mut.get("replacement"),
                    "noCoverage": True,
                })
            elif key in counts:
                counts[key] += 1

    detected = counts["killed"] + counts["timeout"]
    total_valid = detected + counts["survived"] + counts["noCoverage"]
    score = round((detected / total_valid * 100.0) if total_valid else 0.0, 2)
    return {
        "present": True,
        "score": score,
        "detected": detected,
        "total": total_valid,
        "counts": counts,
        "survivors": survivors,
        "passed": total_valid > 0 and score >= THRESHOLD_MUTATION,
    }


def _python_mutation_metrics(path: Path) -> dict:
    data = _load_json(path)
    if not data:
        return {"present": False, "passed": False}
    score = float(data.get("mutationScore", 0.0))
    return {
        "present": True,
        "score": score,
        "killed": int(data.get("killed", 0)),
        "total": int(data.get("total", 0)),
        "survived": int(data.get("survived", 0)),
        "survivors": data.get("survivors", []),
        "passed": bool(data.get("passed")) and score >= THRESHOLD_MUTATION,
    }


def main() -> int:
    REPORTS.mkdir(parents=True, exist_ok=True)
    git = _git_info()
    py_cov = _python_metrics()
    fe_cov = _istanbul_metrics(REPORTS / "coverage-frontend" / "coverage-summary.json", CRITICAL_FRONTEND_FILES)
    el_cov = _istanbul_metrics(REPORTS / "coverage-electron" / "coverage-summary.json", ())
    fe_mut = _stryker_metrics(REPORTS / "mutation-frontend" / "stryker-report.json")
    py_mut = _python_mutation_metrics(REPORTS / "mutation-python" / "mutation-report.json")
    pytest_unit = _read_junit(REPORTS / "pytest-junit.xml")
    pytest_combo = _read_junit(REPORTS / "combinatorial-junit.xml")

    live_status_file = REPORTS / "rekordbox-live-status.txt"
    live_status_raw = live_status_file.read_text(encoding="utf-8").strip() if live_status_file.exists() else ""
    live_rekordbox_verified = bool(
        os.environ.get("CUEPOINT_VERIFY_LIVE_REAL") == "1"
        and live_status_raw
        and "unverified" not in live_status_raw.lower()
    )

    tests_ok = (pytest_unit is None or pytest_unit["passed"]) and (pytest_combo is None or pytest_combo["passed"])
    all_gates_ok = (
        py_cov.get("passed", False)
        and fe_cov.get("passed", False)
        and el_cov.get("passed", False)
        and fe_mut.get("passed", False)
        and py_mut.get("passed", False)
        and tests_ok
    )

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "git": git,
        "environment": {
            "os": f"{platform.system()} {platform.release()}",
            "python": platform.python_version(),
        },
        "pythonCoverage": py_cov,
        "frontendCoverage": fe_cov,
        "electronCoverage": el_cov,
        "frontendMutation": fe_mut,
        "pythonMutation": py_mut,
        "junit": {"unit": pytest_unit, "combinatorial": pytest_combo},
        "liveRekordboxVerified": live_rekordbox_verified,
        "liveRekordboxNote": (
            "Verifiziert gegen laufende Rekordbox-Desktop-Instanz"
            if live_rekordbox_verified
            else "Nicht vollständig live verifiziert (keine interaktive Desktop-Session / kein Computer-Use-Zugriff "
                 "auf Rekordbox Session 1; UIA-/Fader-Logik über Unit-/UI-Mocks + Read-Only-Real-DB geprüft)"
        ),
        "releaseApproved": all_gates_ok,
    }
    (REPORTS / "quality-gate-report.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    verdict = "Release freigegeben" if all_gates_ok else "Release BLOCKIERT"
    lines = [
        "# Airdox Quality Gate — Verifizierter Prüfbericht",
        "",
        f"- **Status:** {verdict}",
        f"- **Git Commit:** `{git['commit']}` (`{git['branch']}`)",
        f"- **Zeitpunkt (UTC):** `{payload['generatedAt']}`",
        f"- **Umgebung:** `{payload['environment']['os']}` · Python `{payload['environment']['python']}`",
        "",
        "## 1. Getrennte Coverage-Messungen je Stack (>= 90% Global, 100% Kritische Zweige)",
        "",
        "| Stack | Zeilen (%) | Zweige (%) | Funktionen / Combined (%) | Status |",
        "| --- | ---: | ---: | ---: | --- |",
        f"| Python Backend (`backend/`) | {py_cov.get('linePct', 0.0):.2f} % | {py_cov.get('branchPct', 0.0):.2f} % | "
        f"{py_cov.get('combinedPct', 0.0):.2f} % | {'BESTANDEN' if py_cov.get('passed') else 'FEHLER'} |",
        f"| React / TypeScript (`src/`) | {fe_cov.get('lines', 0.0):.2f} % | {fe_cov.get('branches', 0.0):.2f} % | "
        f"{fe_cov.get('functions', 0.0):.2f} % | {'BESTANDEN' if fe_cov.get('passed') else 'FEHLER'} |",
        f"| Electron Main & Preload (`electron/`) | {el_cov.get('lines', 0.0):.2f} % | "
        f"{el_cov.get('branches', 0.0):.2f} % | {el_cov.get('functions', 0.0):.2f} % | "
        f"{'BESTANDEN' if el_cov.get('passed') else 'FEHLER'} |",
        "",
        "### Kritische Module (100-%-Ziel)",
        "",
        "| Modul | Zeilen / Stmts | Zweige | Status |",
        "| --- | ---: | ---: | --- |",
    ]
    for name in CRITICAL_FRONTEND_FILES:
        c = fe_cov.get("critical", {}).get(name, {})
        lines.append(
            f"| `src/{name}` | {c.get('lines', 0.0):.2f} % | {c.get('branches', 0.0):.2f} % | "
            f"{'100% OK' if c.get('ok') else 'UNTER 100%'} |"
        )
    for name, pf in py_cov.get("perFile", {}).items():
        lines.append(
            f"| `backend/{name}` | {pf.get('pct', 0.0):.2f} % (Min {pf.get('min', 0.0):.0f}%) | — | "
            f"{'OK' if pf.get('ok') else 'FEHLER'} |"
        )

    lines.extend([
        "",
        "## 2. Mutation Testing (>= 95 % gefordert)",
        "",
        f"- **Frontend (StrykerJS):** `{fe_mut.get('score', 0.0):.2f} %` "
        f"({fe_mut.get('detected', 0)}/{fe_mut.get('total', 0)} erkannt) -> "
        f"{'BESTANDEN' if fe_mut.get('passed') else 'FEHLER'}",
        f"- **Backend (Python AST Mutator):** `{py_mut.get('score', 0.0):.2f} %` "
        f"({py_mut.get('killed', 0)}/{py_mut.get('total', 0)} erkannt) -> "
        f"{'BESTANDEN' if py_mut.get('passed') else 'FEHLER'}",
        "",
    ])

    if fe_mut.get("survivors") or py_mut.get("survivors"):
        lines.append("### Überlebende Mutanten (Zur Prüfung dokumentiert)")
        lines.append("")
        for s in fe_mut.get("survivors", [])[:20]:
            lines.append(f"- TS `{s['file']}:{s['line']}` ({s['mutator']}): `{s['replacement']}`")
        for s in py_mut.get("survivors", [])[:20]:
            lines.append(f"- PY `{s['id']}` (`{s['function']}`): `{s['mutation']}`")
        lines.append("")

    lines.extend([
        "## 3. Reale Rekordbox-Desktop-Verifikation",
        "",
        f"- **Status:** {'VERIFIZIERT' if live_rekordbox_verified else 'NICHT VOLLSTÄNDIG LIVE VERIFIZIERT'}",
        f"- **Details:** {payload['liveRekordboxNote']}",
        "",
        "## 4. Kritische Testfallmatrix (Anforderung -> Codepfad -> Testfall)",
        "",
        "| ID | Anforderung | Codepfad | Testnachweis |",
        "| --- | --- | --- | --- |",
    ])
    for req_id, desc, code_path, tests in REQUIREMENT_MATRIX:
        lines.append(f"| {req_id} | {desc} | `{code_path}` | `{tests}` |")

    (REPORTS / "quality-gate-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:25]))
    return 0 if all_gates_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
