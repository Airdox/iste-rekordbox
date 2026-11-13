"""Exercise the verifier with controlled passing, missing and corrupt evidence."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import quality_gate as gate

RUN = {"commit": "a" * 40, "scope": "test-run"}


def test_python_arc_contexts_use_coverage_report_line_numbering(tmp_path):
    from coverage import CoverageData

    file = tmp_path / "backend/example.py"
    file.parent.mkdir()
    file.write_text("def matches():\n    if (\n        True\n    ):\n        return 1\n", encoding="utf-8")
    gate.write_json(tmp_path / "scripts/quality_requirements.json", {
        "branches": [{"stage": "python", "file": "backend/example.py"}],
    })
    data_file = tmp_path / "coverage-data"
    data = CoverageData(basename=str(data_file))
    data.set_context("tests/test_example.py::test_matches|run")
    data.add_arcs({str(file): [(3, 5)]})
    data.write()
    reports = tmp_path / "reports"
    gate.collect_python_arcs(tmp_path, reports, data_file)
    arcs = gate.read_json(reports / "coverage-python/critical-arcs.json")
    assert arcs["backend/example.py"]["2:5"] == ["tests/test_example.py::test_matches"]


@pytest.fixture
def evidence(tmp_path, monkeypatch):
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    reports = tmp_path / "reports"
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend/keys.py").write_text("if valid:\n    normalize()\n", encoding="utf-8")
    gate.write_json(tmp_path / "scripts/quality_requirements.json", {"branches": [
        {"id": "key", "stage": "python", "file": "backend/keys.py", "tests": ["python"]},
    ]})
    for stage, files in gate.ARTIFACTS.items():
        if stage != "rekordbox":
            gate.record_junit(reports / files[0], stage, 0)
    (reports / "playlist-export-evidence.zip").write_bytes(b"export evidence")
    totals = {"covered_lines": 20, "num_statements": 20, "covered_branches": 20, "num_branches": 20}
    gate.write_json(reports / "coverage-python/coverage.json", {
        "meta": {"branch_coverage": True},
        "totals": totals,
        "files": {"backend/keys.py": {"summary": totals, "executed_branches": [[1, 2]], "missing_branches": []}},
    })
    gate.write_json(reports / "coverage-python/critical-arcs.json", {
        "backend/keys.py": {"1:2": ["tests/test_keys.py::python"]},
    })
    for stack in ("frontend", "electron"):
        gate.write_json(reports / f"coverage-{stack}/coverage-summary.json", {
            "total": {measure: {"covered": 20, "total": 20} for measure in gate.JS_MEASURES},
        })
        gate.write_json(reports / f"coverage-{stack}/coverage-final.json", {})
    gate.write_json(reports / "combinatorial-metrics.json", {
        "schemaVersion": 1, "tracks": 15500, "casesVerified": 100000, "casesPlanned": 100000,
        "nestedCasesVerified": 25000, "timings": {"p50Ms": 1, "p95Ms": 2, "p99Ms": 3, "maxMs": 5},
        "correctnessPassed": True,
    })
    gate.write_json(reports / "mutation-frontend/stryker-report.json", {"files": {
        file: {"mutants": [{"id": str(i), "status": "Killed"} for i in range(30)]} for file in gate.JS_MUTATION
    }})
    counts = {"killed": 20, "survived": 0, "timeout": 0, "error": 0, "total": 20}
    gate.write_json(reports / "mutation-python/mutation-report.json", {
        **{key: value * len(gate.PY_MUTATION) for key, value in counts.items()}, "survivors": [],
        "perFile": dict.fromkeys(gate.PY_MUTATION, counts),
    })
    gate.write_json(reports / "windows-package.json", {
        "portable": "Cuepoint-1.1.0-Windows-x64.exe", "sha256": "a" * 64, "size": 2048,
        "smokedExecutable": "release/win-unpacked/Cuepoint.exe", "portableBootTested": True,
    })
    for stage in (*gate.CI_ARTIFACTS, "windows"):
        gate.seal(reports, stage, RUN)
    return tmp_path, reports


def test_missing_rekordbox_e2e_blocks_only_desktop_and_release(evidence):
    root, reports = evidence
    assert gate.verify(root, reports, RUN)["stages"] == {
        "CI_VALIDATED": "PASSED",
        "WINDOWS_BUILD_VALIDATED": "PASSED",
        "REKORDBOX_E2E_VALIDATED": "BLOCKED",
        "RELEASE_APPROVED": "BLOCKED",
    }


@pytest.mark.parametrize(("stage", "report"), [
    ("python", "coverage-python/coverage.json"),
    ("combinatorial", "combinatorial-junit.xml"),
    ("frontend", "frontend-junit.xml"),
    ("electron", "electron-junit.xml"),
    ("ui", "ui-junit.xml"),
])
def test_missing_report_blocks_ci(evidence, stage, report):
    root, reports = evidence
    (reports / report).unlink()
    result = gate.verify(root, reports, RUN)
    assert result["stages"]["CI_VALIDATED"] == result["stages"]["RELEASE_APPROVED"] == "BLOCKED"
    assert report.rsplit("/", 1)[-1] in result["checks"][stage]["reason"]


def test_missing_packaged_smoke_report_blocks_windows(evidence):
    root, reports = evidence
    (reports / "windows-junit.xml").unlink()
    result = gate.verify(root, reports, RUN)
    assert result["stages"]["CI_VALIDATED"] == "PASSED"
    assert result["stages"]["WINDOWS_BUILD_VALIDATED"] == "BLOCKED"


def test_corrupt_mutation_report_blocks_ci(evidence):
    root, reports = evidence
    (reports / "mutation-frontend/stryker-report.json").write_text('{"files":', encoding="utf-8")
    gate.seal(reports, "mutation-frontend", RUN)
    result = gate.verify(root, reports, RUN)
    assert result["stages"]["CI_VALIDATED"] == "BLOCKED"
    assert "Expecting value" in result["checks"]["mutation-frontend"]["reason"]


def test_per_file_mutation_threshold_cannot_be_masked_by_aggregate(evidence):
    root, reports = evidence
    path = reports / "mutation-frontend/stryker-report.json"
    data = gate.read_json(path)
    for mutant in data["files"]["src/api.ts"]["mutants"][:2]:
        mutant["status"] = "Survived"
    gate.write_json(path, data)
    gate.seal(reports, "mutation-frontend", RUN)
    result = gate.verify(root, reports, RUN)
    assert result["stages"]["CI_VALIDATED"] == "BLOCKED"
    metrics = result["checks"]["mutation-frontend"]["mutation"]
    assert metrics["score"] > 95 > metrics["perFile"]["src/api.ts"]["score"]


def test_uncovered_critical_branch_cannot_be_masked_by_global_coverage(evidence):
    root, reports = evidence
    path = reports / "coverage-python/coverage.json"
    data = gate.read_json(path)
    data["files"]["backend/keys.py"]["missing_branches"] = [[1, -1]]
    data["totals"]["covered_branches"] = 19
    gate.write_json(path, data)
    gate.seal(reports, "python", RUN)
    result = gate.verify(root, reports, RUN)
    assert result["checks"]["python"]["passed"]
    assert not result["criticalBranches"][0]["passed"]
    assert result["stages"]["CI_VALIDATED"] == "BLOCKED"


def test_other_commit_and_run_block_ci(evidence):
    root, reports = evidence
    gate.seal(reports, "frontend", {**RUN, "commit": "b" * 40})
    gate.seal(reports, "electron", {**RUN, "scope": "another-run"})
    result = gate.verify(root, reports, RUN)
    assert result["stages"]["CI_VALIDATED"] == "BLOCKED"
    assert "different commit" in result["checks"]["frontend"]["reason"]
    assert "different run" in result["checks"]["electron"]["reason"]


def test_modified_report_breaks_seal(evidence):
    root, reports = evidence
    (reports / "frontend-junit.xml").write_text("<testsuite/>", encoding="utf-8")
    result = gate.verify(root, reports, RUN)
    assert "content hash differs" in result["checks"]["frontend"]["reason"]


def test_node_junit_reporter_puts_cases_directly_under_testsuites(tmp_path):
    path = tmp_path / "node-junit.xml"
    path.write_text(
        '<testsuites><testcase name="IPC bridge" classname="test"/>'
        '<!-- tests 1 --></testsuites>', encoding="utf-8",
    )
    assert gate.read_junit(path) == {"tests": 1, "names": ["test::IPC bridge"]}


@pytest.mark.parametrize("report", [
    "<notJUnit/>",
    '<testsuite tests="1"><testcase name="suite"><skipped/></testcase></testsuite>',
    '<testsuite tests="1"><testcase name="suite"><failure/></testcase></testsuite>',
    '<testsuite tests="2"><testcase name="suite"/></testsuite>',
])
def test_bad_junit_cannot_pass(evidence, report):
    root, reports = evidence
    (reports / "frontend-junit.xml").write_text(report, encoding="utf-8")
    gate.seal(reports, "frontend", RUN)
    assert gate.verify(root, reports, RUN)["stages"]["CI_VALIDATED"] == "BLOCKED"


def test_prose_status_does_not_count_as_rekordbox_acceptance(evidence):
    root, reports = evidence
    (reports / "rekordbox-e2e.json").write_text(json.dumps({"status": "passed"}), encoding="utf-8")
    gate.seal(reports, "rekordbox", RUN)
    assert gate.verify(root, reports, RUN)["stages"]["REKORDBOX_E2E_VALIDATED"] == "BLOCKED"


@pytest.mark.parametrize("tamper", ["missing screenshot", "text screenshot", "reordered re-export"])
def test_release_requires_the_exact_portable_and_desktop_receipt(evidence, monkeypatch, tamper):
    root, reports = evidence
    package_path = reports / "windows-package.json"
    package = gate.read_json(package_path)
    portable = root / package["portable"]
    portable.write_bytes(b"test candidate")
    package.update(size=portable.stat().st_size, sha256=gate.digest(portable))
    gate.write_json(package_path, package)
    gate.seal(reports, "windows", RUN)
    evidence_file = reports / "rekordbox-evidence/session.log"
    evidence_file.parent.mkdir()
    evidence_file.write_text("synthetic receipt fixture", encoding="utf-8")
    playlist_name = "Cuepoint-QA-1234567890"
    for name in ("01-cuepoint-set.png", "02-cuepoint-handover.png", "03-rekordbox-import-dialog.png",
                 "04-rekordbox-imported-playlist.png"):
        (evidence_file.parent / name).write_bytes(b"\x89PNG\r\n\x1a\n" + name.encode() * 10)
    receipt = evidence_file.parent / "rekordbox-reimport-result.json"
    tracks = [r"C:\Fixture\three.wav", r"C:\Fixture\one.wav", r"C:\Fixture\two.wav"]
    gate.write_json(evidence_file.parent / "fixture.json", {
        "playlist": playlist_name, "tracks": [{"path": path} for path in tracks],
    })
    for name in (playlist_name + ".m3u8", "rekordbox-reexport.m3u8"):
        (evidence_file.parent / name).write_text("#EXTM3U\n" + "\n".join(tracks), encoding="utf-8")
    roundtrip = gate.read_roundtrip(evidence_file.parent)
    gate.write_json(receipt, roundtrip)
    steps = dict.fromkeys(gate.LIVE_STEPS, {
        "passed": True, "observation": "observed in the fixture",
        "files": {evidence_file.name: gate.digest(evidence_file)},
    })
    steps["rekordbox-playlist-reimport"] = {
        "passed": True, "observation": "re-exported from Rekordbox in fixture order",
        "files": {**roundtrip["files"], receipt.name: gate.digest(receipt)},
    }
    gate.write_json(reports / "rekordbox-e2e.json", {
        "schemaVersion": 1, "commit": RUN["commit"], "platform": "Windows", "rekordboxVersion": "7.2.16",
        "testTrack": {"title": "fixture", "artist": "fixture", "bpm": 128, "key": "8A", "deck": 1},
        "operator": "operator", "auditor": "reviewer", "portableSha256": package["sha256"],
        "steps": steps,
    })
    gate.seal(reports, "rekordbox", RUN)
    assert gate.verify(root, reports, RUN, portable)["stages"]["RELEASE_APPROVED"] == "PASSED"
    imported_screenshot = evidence_file.parent / "04-rekordbox-imported-playlist.png"
    reexport = evidence_file.parent / "rekordbox-reexport.m3u8"
    if tamper == "missing screenshot":
        imported_screenshot.unlink()
    else:
        if tamper == "text screenshot":
            changed = imported_screenshot
            changed.write_text("plain text screenshot", encoding="utf-8")
        else:
            changed = reexport
            changed.write_text("#EXTM3U\n" + "\n".join(reversed(tracks)), encoding="utf-8")
        roundtrip["files"][changed.name] = gate.digest(changed)
        gate.write_json(receipt, roundtrip)
        acceptance = gate.read_json(reports / "rekordbox-e2e.json")
        acceptance["steps"]["rekordbox-playlist-reimport"]["files"].update(
            {changed.name: gate.digest(changed), receipt.name: gate.digest(receipt)}
        )
        gate.write_json(reports / "rekordbox-e2e.json", acceptance)
        gate.seal(reports, "rekordbox", RUN)
    assert gate.verify(root, reports, RUN, portable)["stages"]["REKORDBOX_E2E_VALIDATED"] == "BLOCKED"
    portable.write_bytes(b"other candidate")
    assert gate.verify(root, reports, RUN, portable)["stages"]["RELEASE_APPROVED"] == "BLOCKED"
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    assert gate.verify(root, reports, RUN)["stages"]["REKORDBOX_E2E_VALIDATED"] == "BLOCKED"
