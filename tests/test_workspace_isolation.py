from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_hedge.db.transform import ticker_dir_to_row
from ai_hedge.workspaces import normalize_workspace_release


RELEASE_ID = "5c4ea3b9-3817-4d8b-a291-598019958d85"


def test_workspace_release_contract_is_strict() -> None:
    assert normalize_workspace_release("analysis", None) == ("analysis", None)
    assert normalize_workspace_release("nasdaq100", RELEASE_ID) == ("nasdaq100", RELEASE_ID)
    with pytest.raises(ValueError, match="release_id is required"):
        normalize_workspace_release("nasdaq100", None)
    with pytest.raises(ValueError, match="cannot have"):
        normalize_workspace_release("analysis", RELEASE_ID)
    with pytest.raises(ValueError, match="Unsupported workspace"):
        normalize_workspace_release("unknown", None)


def test_transform_persists_workspace_and_release_in_report_and_dashboard(tmp_path: Path) -> None:
    ticker_dir = tmp_path / "AAPL"
    ticker_dir.mkdir()
    dashboard = {
        "ticker": "AAPL",
        "generated_at": "2026-08-21T12:00:00Z",
        "version": "test-v1",
        "header": {"company_name": "Apple", "currency": "USD"},
        "valuation_hub": {"consensus": {}},
    }
    (ticker_dir / "AAPL_dashboard.json").write_text(json.dumps(dashboard), encoding="utf-8")
    (ticker_dir / "AAPL_analysis.txt").write_text("analysis", encoding="utf-8")

    bundle = ticker_dir_to_row(
        ticker_dir,
        source="cli",
        workspace="nasdaq100",
        release_id=RELEASE_ID,
    )

    assert bundle is not None
    assert bundle["report_row"]["workspace"] == "nasdaq100"
    assert bundle["report_row"]["release_id"] == RELEASE_ID
    assert bundle["artifact_row"]["dashboard"]["workspace"] == "nasdaq100"
    assert bundle["artifact_row"]["dashboard"]["release_id"] == RELEASE_ID


def test_workspace_migration_contains_atomic_release_and_scoped_portfolio_guards() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "ai_hedge"
        / "db"
        / "migrations"
        / "007_workspace_isolation.sql"
    ).read_text(encoding="utf-8")
    assert "reports_workspace_release_check" in migration
    assert "cannot add reports to an active release" in migration
    assert "FOR UPDATE" in migration
    assert "portfolio_snapshots_workspace_unique" in migration
    assert "PRIMARY KEY (workspace, track, lens_type, lens_key, methodology_version, nav_date)" in migration


def test_universe_run_migration_supports_incremental_visibility_and_resume() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "ai_hedge"
        / "db"
        / "migrations"
        / "008_nasdaq_universe_runs.sql"
    ).read_text(encoding="utf-8")

    assert "'staged', 'running', 'active'" in migration
    assert "release_status NOT IN ('staged', 'running')" in migration
    assert "nasdaq_universe_runs" in migration
    assert "nasdaq_universe_run_items" in migration
    assert "max_attempts" in migration
    assert "available_at" in migration
    assert "coverage_complete" in migration


def test_portfolio_unlocks_the_active_nasdaq_cohort_after_full_coverage() -> None:
    portfolio_db = (
        Path(__file__).resolve().parents[1]
        / "frontend"
        / "src"
        / "lib"
        / "portfolio-db.ts"
    ).read_text(encoding="utf-8")

    assert "rr.status = 'active'" in portfolio_db
    assert "coverage_release.workspace = 'nasdaq100'" in portfolio_db
    assert "coverage_release.coverage_complete" in portfolio_db


def test_worker_pool_migration_has_leases_budget_and_concurrency_guards() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "ai_hedge"
        / "db"
        / "migrations"
        / "009_nasdaq_worker_pool.sql"
    ).read_text(encoding="utf-8")

    assert "lease_expires_at" in migration
    assert "next_attempt_at" in migration
    assert "estimated_cost_per_attempt_usd" in migration
    assert "budget_limit_usd" in migration
    assert "concurrency BETWEEN 1 AND 12" in migration


def test_universe_worker_reconciles_committed_reports_before_retrying() -> None:
    worker = (
        Path(__file__).resolve().parents[1] / "scripts" / "nasdaq_universe_run.py"
    ).read_text(encoding="utf-8")

    assert "A process can be interrupted after the report transaction commits" in worker
    assert "SET status = 'completed', report_id = existing.id" in worker


def test_nasdaq_budget_migration_raises_the_default_to_600() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "ai_hedge"
        / "db"
        / "migrations"
        / "010_nasdaq_budget_limit_600.sql"
    ).read_text(encoding="utf-8")

    assert "ALTER COLUMN budget_limit_usd SET DEFAULT 600" in migration


def test_nasdaq_diagnostics_migration_preserves_attempts_and_stopped_status() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "ai_hedge"
        / "db"
        / "migrations"
        / "014_nasdaq_run_diagnostics.sql"
    ).read_text(encoding="utf-8")

    assert "'stopped'" in migration
    assert "stopped_count" in migration
    assert "final_status_reason" in migration
    assert "nasdaq_universe_run_attempts" in migration
    assert "PRIMARY KEY (run_id, ticker, attempt)" in migration
