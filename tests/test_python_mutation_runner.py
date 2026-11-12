"""Regression tests for mutation-runner outcome classification."""

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from mutate_backend import _run_pytest, _summary


@pytest.mark.parametrize(
    ("exit_code", "test_results", "expected"),
    [
        (0, "", "survived"),
        (1, "<failure>expected mutation failure</failure>", "killed"),
        (1, "<error>failed to set up fixture</error>", "error"),
        (2, "<failure>interrupted run</failure>", "error"),
        (0, "<skipped />", "error"),
        (1, None, "error"),
    ],
)
def test_mutation_status_requires_test_failure_evidence(tmp_path, monkeypatch, exit_code, test_results, expected):
    report = tmp_path / "junit.xml"
    report.write_text('<testsuite><testcase name="stale" classname="stale"><failure /></testcase></testsuite>')

    def fake_run(command, **_options):
        if test_results is not None:
            report.write_text(
                f'<testsuite><testcase name="test" classname="case">{test_results}</testcase></testsuite>'
            )
        return subprocess.CompletedProcess(command, exit_code, "stdout", "stderr")

    monkeypatch.setattr(subprocess, "run", fake_run)
    outcome = _run_pytest(tmp_path, ("test_case.py",), report, 1)
    assert outcome["status"] == expected
    assert outcome["failedTests"] == (["case::test"] if "<failure>" in (test_results or "") else [])


def test_mutation_timeout_is_separate_from_test_failures(tmp_path, monkeypatch):
    def fake_run(command, **options):
        raise subprocess.TimeoutExpired(command, options["timeout"], output=b"partial output")

    monkeypatch.setattr(subprocess, "run", fake_run)
    outcome = _run_pytest(tmp_path, ("test_case.py",), tmp_path / "junit.xml", 1)
    assert outcome["status"] == "timeout"
    assert "partial output" in outcome["diagnostic"]
    summary = _summary([*[{"status": "killed"}] * 99, outcome], 95)
    assert summary["mutationScore"] == 99
    assert summary["killed"] == 99
    assert summary["timeout"] == 1
    assert not summary["passed"]
