from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from ai_hedge.deep_research.integration import (
    DeepResearchProcess,
    _child_environment,
    build_summary,
    snapshot_from_platform_inputs,
    unavailable_summary,
)
from ai_hedge.deep_research.integration_worker import production_config


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_platform_snapshot_contains_identity_but_no_ai_hedge_target() -> None:
    snapshot = snapshot_from_platform_inputs(
        "TEST",
        {
            "short_name": "Test Co",
            "info": {
                "longName": "Test Company",
                "exchange": "NMS",
                "currency": "USD",
                "financialCurrency": "EUR",
                "currentPrice": 42.0,
                "targetMeanPrice": 999.0,
            },
        },
    )

    assert snapshot.company_name == "Test Company"
    assert snapshot.current_price == 42.0
    assert "target" not in snapshot.to_dict()


def test_summary_enforces_cost_cap_without_erasing_a_valid_artifact(tmp_path: Path) -> None:
    _write_json(
        tmp_path / "research_manifest.json",
        {
            "controller_model": "deepseek-reasoner",
            "helper_model": "deepseek-chat",
            "duration_seconds": 100,
            "usage_and_cost": {"estimated_cost_usd": 1.51},
        },
    )
    _write_json(
        tmp_path / "research_grade.json",
        {"publication_status": "amber", "target_usable": True},
    )
    _write_json(
        tmp_path / "valuation_compiled.json",
        {
            "valid": True,
            "compiled": {
                "target_price": 50.0,
                "reference_date": "2026-01-01",
                "target_date": "2027-01-01",
                "currency": "USD",
                "methods": [],
            },
        },
    )
    _write_json(tmp_path / "valuation_case.json", {"evidence": [], "methods": []})

    summary = build_summary(tmp_path)

    assert summary["status"] == "budget_exceeded"
    assert summary["target_usable"] is False
    assert summary["target_price"] is None
    assert summary["investment_amount"] is None
    assert summary["artifacts"]["compiled_result"].endswith("valuation_compiled.json")


def test_process_timeout_is_fail_open_and_kills_worker(tmp_path: Path) -> None:
    class FakeProcess:
        returncode = None
        killed = False

        def communicate(self, timeout: float | None = None):
            if not self.killed:
                raise subprocess.TimeoutExpired("worker", timeout or 0)
            return "", "killed"

        def kill(self) -> None:
            self.killed = True

    process = FakeProcess()
    handle = DeepResearchProcess(
        process=process,  # type: ignore[arg-type]
        root=tmp_path,
        result_path=tmp_path / "missing.json",
        started_monotonic=time.monotonic() - 10,
    )

    result = handle.collect(timeout_seconds=1)

    assert process.killed is True
    assert result["status"] == "timed_out"
    assert result["target_usable"] is False


def test_production_worker_clamps_env_overrides_to_policy_limits(monkeypatch) -> None:
    monkeypatch.setenv("DEEPSEEK_RESEARCH_MAX_COST_USD", "9")
    monkeypatch.setenv("DEEPSEEK_RESEARCH_MAX_SECONDS", "3600")

    config = production_config()

    assert config.max_cost_usd == 1.5
    assert config.max_seconds == 2400


def test_child_environment_bootstraps_source_tree_without_existing_pythonpath(monkeypatch) -> None:
    monkeypatch.delenv("PYTHONPATH", raising=False)

    child_env = _child_environment()
    completed = subprocess.run(
        [sys.executable, "-c", "import ai_hedge.deep_research.integration_worker"],
        cwd=os.fspath(Path.cwd().parent),
        env=child_env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert str(Path(__file__).resolve().parents[1] / "src") in child_env["PYTHONPATH"]


def test_unavailable_summary_redacts_runtime_paths_and_credentials() -> None:
    payload = unavailable_summary(
        "failed",
        'Traceback (most recent call last):\n  File "C:\\Users\\Person\\secret.py", line 1\n'
        "RuntimeError: failed under /app/src/ai_hedge with api-key-abcdefghijklmnop",
        stderr="C:\\Users\\Person\\private\\worker.log",
    )

    rendered = json.dumps(payload)
    assert "C:\\\\Users" not in rendered
    assert "/app/src" not in rendered
    assert "abcdefghijklmnop" not in rendered
    assert "RuntimeError" in payload["unavailable_reason"]

