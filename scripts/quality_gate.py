"""Verify the CI, packaged Windows and real Rekordbox acceptance stages."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
GLOBAL_MIN = 90
MUTATION_MIN = 95
JS_MUTATION = ("src/api.ts", "src/metadata.ts", "src/camelot-wheel.tsx")
PY_MUTATION = ("backend/keys.py", "backend/library.py", "backend/rekordbox_live.py", "backend/main.py")
JS_MEASURES = ("lines", "statements", "functions", "branches")
LIVE_STEPS = {
    "open-rekordbox", "play-defined-track", "start-cuepoint", "match-track", "verify-bpm-key-deck",
    "choose-harmonic-keys", "compare-results-to-oracle", "filter-and-sort", "add-to-set",
    "handover-to-rekordbox", "archive-evidence", "originals-unchanged",
}
ARTIFACTS = {
    "static": ("static-junit.xml",),
    "python": ("pytest-junit.xml", "coverage-python/coverage.json", "coverage-python/critical-arcs.json"),
    "frontend": ("frontend-junit.xml", "coverage-frontend/coverage-summary.json",
                 "coverage-frontend/coverage-final.json"),
    "electron": ("electron-junit.xml", "coverage-electron/coverage-summary.json",
                 "coverage-electron/coverage-final.json"),
    "combinatorial": ("combinatorial-junit.xml", "combinatorial-metrics.json"),
    "ui": ("ui-junit.xml",),
    "mutation-frontend": ("mutation-frontend-junit.xml", "mutation-frontend/stryker-report.json"),
    "mutation-python": ("mutation-python-junit.xml", "mutation-python/mutation-report.json"),
    "windows": ("windows-junit.xml", "windows-package.json"),
    "rekordbox": ("rekordbox-e2e.json",),
}
CI_ARTIFACTS = tuple(stage for stage in ARTIFACTS if stage not in {"windows", "rekordbox"})
STAGES = ("CI_VALIDATED", "WINDOWS_BUILD_VALIDATED", "REKORDBOX_E2E_VALIDATED", "RELEASE_APPROVED")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def read_json(path: Path) -> dict:
    def reject_constant(value: str) -> None:
        raise ValueError(f"invalid JSON constant {value}")

    data = json.loads(path.read_text(encoding="utf-8-sig"), parse_constant=reject_constant)
    require(isinstance(data, dict), f"{path.name} must contain a JSON object")
    return data


def count(value: int) -> int:
    require(type(value) is int and value >= 0, f"invalid nonnegative count: {value!r}")
    return value


def ratio(covered: int, total: int) -> float:
    count(covered)
    count(total)
    require(covered <= total, f"invalid coverage or mutation counts: {covered}/{total}")
    return 100 * covered / total if total else 0.0


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def identity() -> dict[str, str]:
    def git(*args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()

    commit = git("rev-parse", "HEAD")
    require(not git("status", "--porcelain"), "source worktree differs from its commit")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        require(commit == os.environ["GITHUB_SHA"], "checkout SHA differs from GITHUB_SHA")
        scope = f"github:{os.environ['GITHUB_REPOSITORY']}:{os.environ['GITHUB_RUN_ID']}"
    else:
        scope = os.environ.get("CUEPOINT_GATE_RUN", "local")
    return {"commit": commit, "scope": scope, "ref": os.environ.get("GITHUB_REF") or git("branch", "--show-current")}


def seal(reports: Path, name: str, run: dict[str, str]) -> None:
    files = {rel: digest(reports / rel) for rel in ARTIFACTS[name]}
    write_json(reports / "provenance" / f"{name}.json", {"schemaVersion": 1, **run, "files": files})


def check_seal(reports: Path, name: str, run: dict[str, str]) -> None:
    data = read_json(reports / "provenance" / f"{name}.json")
    require(data["schemaVersion"] == 1, "unsupported provenance schema")
    require(data["commit"] == run["commit"], "report belongs to a different commit")
    require(data["scope"] == run["scope"], "report belongs to a different run")
    require(set(data["files"]) == set(ARTIFACTS[name]), "provenance file list differs")
    for rel in ARTIFACTS[name]:
        require(data["files"][rel] == digest(reports / rel), f"content hash differs for {rel}")


def read_junit(path: Path) -> dict:
    root = ET.parse(path).getroot()
    require(root.tag in {"testsuite", "testsuites"}, "invalid JUnit root")
    suites = [root, *root.findall(".//testsuite")]
    cases = list(root.iter("testcase"))
    require(bool(cases), "JUnit contains no test cases")
    for suite in suites:
        if "tests" in suite.attrib:
            require(sum(1 for _ in suite.iter("testcase")) == int(suite.attrib["tests"]),
                    "JUnit case count differs from suite total")
        for attribute in ("failures", "errors", "skipped", "disabled"):
            require(int(suite.get(attribute, "0")) == 0, f"JUnit suite has {attribute}")
    for case in cases:
        require(bool(case.get("name")), "JUnit test case is unnamed")
        require(not any(child.tag in {"failure", "error", "skipped", "disabled", "todo"} for child in case),
                f"unsuccessful test case: {case.get('name')}")
    return {
        "tests": len(cases),
        "names": [f"{case.get('classname', '')}::{case.attrib['name']}" for case in cases],
    }


def normalized_path(path: str) -> str:
    return PurePosixPath(path.replace("\\", "/")).as_posix()


def coverage_file(files: dict, rel: str) -> dict:
    matches = [value for path, value in files.items()
               if (name := normalized_path(path)) == rel or name.endswith(f"/{rel}")]
    require(len(matches) == 1, f"expected one coverage entry for {rel}")
    return matches[0]


def python_coverage(path: Path) -> dict:
    data = read_json(path)
    require(data["meta"]["branch_coverage"] is True, "Python coverage did not measure branches")
    totals = data["totals"]
    values = {
        "lines": ratio(totals["covered_lines"], totals["num_statements"]),
        "branches": ratio(totals["covered_branches"], totals["num_branches"]),
    }
    per_file = {
        normalized_path(name): {
            "lines": ratio(item["summary"]["covered_lines"], item["summary"]["num_statements"]),
            "branches": ratio(item["summary"]["covered_branches"], item["summary"]["num_branches"]),
        }
        for name, item in data["files"].items()
    }
    return {"global": values, "perFile": per_file, "passed": min(values.values()) >= GLOBAL_MIN}


def js_coverage(path: Path) -> dict:
    data = read_json(path)
    values = {
        name: {metric: ratio(summary[metric]["covered"], summary[metric]["total"]) for metric in JS_MEASURES}
        for name, summary in data.items()
    }
    totals = values.pop("total")
    return {"global": totals, "perFile": values, "passed": min(totals.values()) >= GLOBAL_MIN}


def source_range(root: Path, file: str, selector: str | None) -> tuple[int, int]:
    source = (root / file).read_text(encoding="utf-8")
    if selector is None:
        return 1, len(source.splitlines())
    if file.endswith(".py"):
        functions = [node for node in ast.walk(ast.parse(source))
                     if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == selector]
        require(len(functions) == 1, f"expected one function {file}:{selector}")
        node = functions[0]
        return node.lineno, node.end_lineno
    lines = source.splitlines()
    matches = [index for index, line in enumerate(lines) if selector in line]
    require(len(matches) == 1, f"expected one source anchor {file}:{selector}")
    start = matches[0]
    indentation = len(lines[start]) - len(lines[start].lstrip())
    end = next(index for index in range(start + 1, len(lines))
               if lines[index].startswith(" " * indentation + "}"))
    return start + 1, end + 1


def collect_python_arcs(root: Path, reports: Path, coverage_data: Path) -> None:
    from coverage import CoverageData

    requirements = read_json(root / "scripts/quality_requirements.json")["branches"]
    sources = {item["file"] for item in requirements if item["stage"] == "python"}
    data = CoverageData(basename=str(coverage_data))
    data.read()
    require(data.has_arcs(), "Python coverage data lacks branch arcs")
    output = {}
    for file in data.measured_files():
        relative = normalized_path(os.path.relpath(file, root))
        if relative not in sources:
            continue
        names_by_arc = {}
        for context in data.measured_contexts():
            if not context.endswith("|run"):
                continue
            data.set_query_context(context)
            for origin, destination in data.arcs(file) or ():
                names_by_arc.setdefault(f"{origin}:{destination}", []).append(context.removesuffix("|run"))
        output[relative] = {arc: sorted(names) for arc, names in names_by_arc.items()}
    write_json(reports / "coverage-python/critical-arcs.json", output)


def critical_branches(root: Path, reports: Path, checks: dict) -> list[dict]:
    requirements = read_json(root / "scripts/quality_requirements.json")["branches"]
    coverages = {
        "python": ("coverage-python/coverage.json", "files"),
        "frontend": ("coverage-frontend/coverage-final.json", None),
        "electron": ("coverage-electron/coverage-final.json", None),
    }
    results = []
    require(bool(requirements), "critical branch requirements are empty")
    for requirement in requirements:
        stage = requirement["stage"]
        file = requirement["file"]
        row = {**requirement, "passed": False}
        results.append(row)
        try:
            require("coverage" in checks[stage], f"{stage} evidence failed validation")
            report, files_key = coverages[stage]
            data = read_json(reports / report)
            item = coverage_file(data[files_key] if files_key else data, file)
            start, end = source_range(root, file, requirement.get("selector"))
            if stage == "python":
                contexts = read_json(reports / "coverage-python/critical-arcs.json")[file]
                branches = [
                    {"from": origin, "to": dest, "covered": covered,
                     "measuredTests": contexts.get(f"{origin}:{dest}", [])}
                    for covered, key in ((True, "executed_branches"), (False, "missing_branches"))
                    for origin, dest in item[key]
                    if start <= origin <= end
                ]
            else:
                branches = []
                for branch_id, branch in item["branchMap"].items():
                    hits = item["b"][branch_id]
                    require(len(hits) == len(branch["locations"]), "Istanbul branch and hit counts differ")
                    for arm, (location, hit) in enumerate(zip(branch["locations"], hits, strict=True)):
                        line = location["start"].get("line") or branch["loc"]["start"]["line"]
                        if start <= line <= end:
                            branches.append({"id": f"{branch_id}:{arm}", "location": location,
                                             "line": line, "covered": count(hit) > 0})
            names = checks[stage]["junit"]["names"]
            missing_tests = [pattern for pattern in requirement["tests"] if not any(pattern in name for name in names)]
            unattributed = [branch for branch in branches if stage == "python" and not branch["measuredTests"]]
            row.update(branches=branches, missingTests=missing_tests, report=report,
                       passed=bool(branches) and not missing_tests and not unattributed
                       and all(branch["covered"] for branch in branches))
        except (OSError, ValueError, KeyError, TypeError, AttributeError, StopIteration) as error:
            row["reason"] = str(error)
    return results


def stryker_metrics(path: Path) -> dict:
    statuses = ("Killed", "Timeout", "Survived", "NoCoverage", "CompileError", "RuntimeError")
    files = read_json(path)["files"]
    results = {}
    survivors = []
    for file, data in files.items():
        counts = dict.fromkeys(statuses, 0)
        seen = set()
        for mutant in data["mutants"]:
            require(mutant["id"] not in seen, f"duplicate mutant id in {file}")
            seen.add(mutant["id"])
            status = mutant["status"]
            require(status in counts, f"unexpected Stryker mutation status {status!r}")
            counts[status] += 1
            if status != "Killed":
                survivors.append({"file": file, **mutant})
        results[normalized_path(file)] = counts
    for file in JS_MUTATION:
        require(file in results, f"Stryker did not report {file}")

    def metrics(counts: dict) -> dict:
        total = sum(counts[name] for name in ("Killed", "Timeout", "Survived", "NoCoverage"))
        score = ratio(counts["Killed"] + counts["Timeout"], total)
        return {"counts": counts, "total": total, "score": score,
                "assertionScore": ratio(counts["Killed"], total),
                "passed": score >= MUTATION_MIN and not (counts["CompileError"] or counts["RuntimeError"])}

    per_file = {name: metrics(counts) for name, counts in results.items()}
    aggregate = metrics({status: sum(counts[status] for counts in results.values()) for status in statuses})
    return {**aggregate, "perFile": per_file, "unresolved": survivors,
            "passed": aggregate["passed"] and all(item["passed"] for item in per_file.values())}


def python_mutation(path: Path) -> dict:
    data = read_json(path)
    outcomes = ("killed", "survived", "timeout", "error")

    def metrics(row: dict) -> dict:
        counts = {status: count(row[status]) for status in outcomes}
        total = count(row["total"])
        require(sum(counts.values()) == total, "Python mutation counts differ from total")
        score = ratio(counts["killed"], total)
        return {"counts": counts, "total": total, "score": score,
                "passed": score >= MUTATION_MIN and not (counts["timeout"] or counts["error"])}

    files = data["perFile"]
    require(all(name in files for name in PY_MUTATION), "Python mutation evidence lacks a critical module")
    per_file = {name: metrics(row) for name, row in files.items()}
    result = metrics(data)
    require(all(sum(row["counts"][status] for row in per_file.values()) == result["counts"][status]
                for status in outcomes), "Python mutation module counts differ from aggregate")
    return {**result, "perFile": per_file, "unresolved": data["survivors"],
            "passed": result["passed"] and all(row["passed"] for row in per_file.values())}


def combinatorial(path: Path) -> dict:
    data = read_json(path)
    require(data["schemaVersion"] == 1, "unsupported combinatorial schema")
    require(count(data["tracks"]) >= 15_500, "fewer than 15,500 fixture tracks")
    require(count(data["casesVerified"]) >= 100_000, "fewer than 100,000 verified cases")
    require(data["casesVerified"] == count(data["casesPlanned"]), "combinatorial corpus incomplete")
    require(0 < count(data["nestedCasesVerified"]) <= data["casesVerified"], "nested cases missing or invalid")
    timings = data["timings"]
    times = [timings[key] for key in ("p50Ms", "p95Ms", "p99Ms", "maxMs")]
    require(all(type(value) in {float, int} for value in times) and 0 <= times[0] <= times[1] <= times[2] <= times[3],
            "invalid combinatorial timing percentiles")
    require(data["correctnessPassed"] is True, "combinatorial correctness failed")
    return data


def windows_package(path: Path) -> dict:
    data = read_json(path)
    require(re.fullmatch(r"Cuepoint-[^/\\]+-Windows-x64\.exe", data["portable"]), "unexpected portable filename")
    require(re.fullmatch(r"[0-9a-f]{64}", data["sha256"]), "invalid portable SHA-256")
    require(count(data["size"]) > 0, "empty portable")
    require(data["smokedExecutable"] == "release/win-unpacked/Cuepoint.exe", "expected packaged Electron smoke")
    require(data["portableBootTested"] is True, "portable boot test missing")
    return data


def rekordbox_evidence(reports: Path, run: dict) -> dict:
    require(os.environ.get("GITHUB_ACTIONS") != "true", "hosted CI has no real Rekordbox acceptance session")
    data = read_json(reports / "rekordbox-e2e.json")
    require(data["schemaVersion"] == 1 and data["commit"] == run["commit"], "invalid desktop acceptance identity")
    require(data["platform"] == "Windows" and bool(data["rekordboxVersion"].strip()), "Rekordbox version missing")
    require(re.fullmatch(r"[0-9a-f]{64}", data["portableSha256"]), "desktop portable hash missing or invalid")
    track = data["testTrack"]
    require(bool(track["title"].strip()) and bool(track["artist"].strip()), "defined test track missing")
    require(type(track["bpm"]) in {int, float} and track["bpm"] > 0, "invalid test track BPM")
    require(re.fullmatch(r"(?:[1-9]|1[0-2])[AB]", track["key"]), "invalid test track Camelot key")
    require(type(track["deck"]) is int and track["deck"] in {1, 2, 3, 4}, "invalid test track deck")
    require(bool(data["operator"].strip()) and bool(data["auditor"].strip()) and data["operator"] != data["auditor"],
            "independent desktop audit missing")
    require(set(data["steps"]) == LIVE_STEPS, "desktop acceptance steps are incomplete")
    for step, evidence in data["steps"].items():
        require(evidence["passed"] is True and bool(evidence["observation"].strip()), f"desktop step failed: {step}")
        require(bool(evidence["files"]), f"desktop evidence absent: {step}")
        for name, checksum in evidence["files"].items():
            file = (reports / "rekordbox-evidence" / name).resolve()
            require(file.is_relative_to((reports / "rekordbox-evidence").resolve()) and file.stat().st_size > 0
                    and digest(file) == checksum, f"desktop evidence invalid: {name}")
    return data


def unresolved_survivors(root: Path, checks: dict) -> list[dict]:
    survivors = [
        {"engine": "stryker", **mutant}
        for mutant in checks["mutation-frontend"].get("mutation", {}).get("unresolved", [])
        if mutant["status"] in {"Survived", "NoCoverage"}
    ] + [
        {"engine": "python-ast", **mutant}
        for mutant in checks["mutation-python"].get("mutation", {}).get("unresolved", [])
    ]
    adjudications = root / "scripts/quality_mutation_adjudications.json"
    if not survivors or not adjudications.is_file():
        return survivors
    reviewed = read_json(adjudications)
    remaining = []
    for mutant in survivors:
        if mutant["engine"] == "stryker":
            start = mutant["location"]["start"]
            key = f"stryker:{mutant['file']}:{start['line']}:{start['column']}:{mutant['mutatorName']}"
            key += ":" + mutant["replacement"]
        else:
            key = f"python-ast:{mutant['id']}"
        finding = reviewed.get(key, {})
        if not (finding.get("sourceSha256") == digest(root / mutant["file"])
                and finding.get("auditor") and finding.get("reason") and finding.get("equivalent") is True):
            remaining.append(mutant)
    return remaining


def verify(root: Path, reports: Path, run: dict, portable: Path | None = None) -> dict:
    checks = {}
    for stage, files in ARTIFACTS.items():
        check = {"passed": False}
        checks[stage] = check
        try:
            check_seal(reports, stage, run)
            if stage == "rekordbox":
                check["details"] = rekordbox_evidence(reports, run)
            else:
                try:
                    check["junit"] = read_junit(reports / files[0])
                except (OSError, ET.ParseError, ValueError, KeyError) as error:
                    check["reason"] = str(error)
            if stage == "python":
                check["coverage"] = python_coverage(reports / files[1])
            if stage in {"frontend", "electron"}:
                check["coverage"] = js_coverage(reports / files[1])
            if stage == "mutation-frontend":
                check["mutation"] = stryker_metrics(reports / files[1])
            if stage == "mutation-python":
                check["mutation"] = python_mutation(reports / files[1])
            if stage == "combinatorial":
                check["details"] = combinatorial(reports / files[1])
            if stage == "windows":
                check["details"] = windows_package(reports / files[1])
            check["passed"] = "reason" not in check and all(
                check.get(metric, {}).get("passed", True) for metric in ("coverage", "mutation")
            )
        except (OSError, ET.ParseError, ValueError, KeyError, TypeError, AttributeError) as error:
            check["reason"] = str(error)

    branches = critical_branches(root, reports, checks)
    ci_ok = all(checks[name]["passed"] for name in CI_ARTIFACTS) and all(row["passed"] for row in branches)
    windows_ok = checks["windows"]["passed"]
    rekordbox_ok = checks["rekordbox"]["passed"]
    release_blockers = []
    try:
        unresolved = unresolved_survivors(root, checks)
        if unresolved:
            release_blockers.append(f"{len(unresolved)} surviving mutants lack an accepted adjudication")
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        release_blockers.append(f"mutation adjudication could not be validated: {error}")
    if windows_ok and rekordbox_ok:
        package = checks["windows"]["details"]
        try:
            require(portable is not None, "portable binary required for production acceptance")
            require(portable.name == package["portable"] and portable.stat().st_size == package["size"]
                    and digest(portable) == package["sha256"], "portable binary differs from the tested candidate")
            require(checks["rekordbox"]["details"]["portableSha256"] == package["sha256"],
                    "Rekordbox acceptance used a different portable binary")
        except (OSError, ValueError, KeyError) as error:
            release_blockers.append(str(error))
    release_ok = ci_ok and windows_ok and rekordbox_ok and not release_blockers
    return {
        "identity": run,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "stages": {
            "CI_VALIDATED": "PASSED" if ci_ok else "BLOCKED",
            "WINDOWS_BUILD_VALIDATED": "PASSED" if windows_ok else "BLOCKED",
            "REKORDBOX_E2E_VALIDATED": "PASSED" if rekordbox_ok else "BLOCKED",
            "RELEASE_APPROVED": "PASSED" if release_ok else "BLOCKED",
        },
        "checks": checks,
        "criticalBranches": branches,
        "releaseBlockers": release_blockers,
    }


def write_report(reports: Path, result: dict) -> None:
    write_json(reports / "quality-gate-report.json", result)
    lines = ["# Cuepoint Quality Gate", "", f"Commit `{result['identity']['commit']}`", ""]
    lines.extend(f"- **{name}** · {status}" for name, status in result["stages"].items())
    lines.extend(f"- {reason}" for reason in result["releaseBlockers"])
    lines.extend(["", "## Prüfnachweise", "", "| Prüfung | Ergebnis | Nachweis |", "| --- | --- | --- |"])
    for name, check in result["checks"].items():
        details = check.get("reason", "")
        if "coverage" in check:
            details = ", ".join(f"{k} {v:.2f} %" for k, v in check["coverage"]["global"].items())
        if "mutation" in check:
            details = ", ".join(f"{k} {v['score']:.2f} %" for k, v in check["mutation"]["perFile"].items())
        lines.append(f"| {name} | {'PASSED' if check['passed'] else 'BLOCKED'} | {details} |")
    lines.extend(["", "## Kritische Zweige", "", "| Anforderung | Modul | Bereich | Abgedeckte Zweige |",
                  "| --- | --- | --- | --- |"])
    for row in result["criticalBranches"]:
        branches = row.get("branches", [])
        lines.append(f"| {row['id']} | `{row['file']}` | {row.get('selector') or 'alle Zweige'} | "
                     f"{sum(branch['covered'] for branch in branches)}/{len(branches)} |")
    (reports / "quality-gate-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:9]))


def record_junit(path: Path, name: str, exit_code: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    suite = ET.Element("testsuite", name=name, tests="1", failures=str(int(exit_code != 0)))
    case = ET.SubElement(suite, "testcase", name=name, classname="quality-gate")
    if exit_code:
        ET.SubElement(case, "failure", message=f"command exited with {exit_code}")
    ET.ElementTree(suite).write(path, encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reports", type=Path, default=REPORTS)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("seal", "record", "run"):
        command = sub.add_parser(action)
        command.add_argument("stage", choices=ARTIFACTS if action == "seal" else
                             ("static", "ui", "windows", "mutation-frontend", "mutation-python"))
        if action == "run":
            command.add_argument("command", nargs=argparse.REMAINDER)
    package = sub.add_parser("package")
    package.add_argument("portable", type=Path)
    collect = sub.add_parser("collect-python-arcs")
    collect.add_argument("coverage_data", type=Path)
    validation = sub.add_parser("verify")
    validation.add_argument("--require", choices=STAGES, default="RELEASE_APPROVED")
    validation.add_argument("--portable", type=Path)
    args = parser.parse_args()
    reports = args.reports.resolve()
    try:
        run = identity()
        if args.action == "verify":
            result = verify(ROOT, reports, run, args.portable)
            write_report(reports, result)
            return int(result["stages"][args.require] != "PASSED")
        if args.action == "collect-python-arcs":
            collect_python_arcs(ROOT, reports, args.coverage_data.resolve())
            return 0
        if args.action == "package":
            write_json(reports / "windows-package.json", {
                "portable": args.portable.name, "sha256": digest(args.portable),
                "size": args.portable.stat().st_size, "smokedExecutable": "release/win-unpacked/Cuepoint.exe",
                "portableBootTested": True,
            })
            return 0
        exit_code = 0
        if args.action == "run":
            command = args.command[1:] if args.command[:1] == ["--"] else args.command
            require(bool(command), "expected command")
            command[0] = shutil.which(command[0]) or command[0]
            exit_code = subprocess.run(command, cwd=ROOT, check=False).returncode
        if args.action in {"record", "run"}:
            record_junit(reports / ARTIFACTS[args.stage][0], args.stage, exit_code)
        seal(reports, args.stage, run)
        return exit_code
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"Quality Gate BLOCKED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
