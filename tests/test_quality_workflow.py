"""Contract tests for the workflow event policy and evidence wiring."""

from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/quality-gate.yml"


def test_only_stale_pull_requests_share_a_cancellable_group():
    workflow = WORKFLOW.read_text(encoding="utf-8")
    concurrency = workflow.split("\nconcurrency:\n", 1)[1].split("\n\njobs:", 1)[0]
    assert concurrency.splitlines() == [
        "  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}",
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    ]


def test_report_consumes_all_producer_artifacts_without_claiming_desktop_acceptance():
    workflow = WORKFLOW.read_text(encoding="utf-8")
    for name in ("static", "unit", "combinatorial", "ui", "mutation-frontend", "mutation-python", "windows"):
        assert f"name: stage-{name}\n" in workflow
    assert "pattern: stage-*" in workflow
    assert "verify --require CI_VALIDATED" in workflow
    assert "seal rekordbox" not in workflow
    assert "record rekordbox" not in workflow


def test_cancellations_are_observed_outside_the_cancelled_workflow():
    observer = WORKFLOW.with_name("quality-gate-cancellations.yml").read_text(encoding="utf-8")
    name = WORKFLOW.read_text(encoding="utf-8").splitlines()[0].removeprefix("name: ")
    assert f'workflows: ["{name}"]' in observer
    assert "workflow_run:" in observer and "types: [completed]" in observer
    assert "github.event.workflow_run.conclusion == 'cancelled'" in observer
    assert "commit: run.head_sha" in observer and "initiator unknown" in observer
