from pathlib import Path

from scripts.db.bootstrap import CORE_TABLES, classify_core_state
from scripts.db.audit import audit_failures, expected_tables_from_repo


ROOT = Path(__file__).resolve().parents[1]


def test_expected_tables_include_each_persistence_domain() -> None:
    expected = expected_tables_from_repo(ROOT)

    assert CORE_TABLES.issubset(expected)
    assert {
        "schema_migrations",
        "site_runs",
        "nasdaq_universe_runs",
        "portfolio_snapshots",
        "trading_connections",
        "obs_runs",
    }.issubset(expected)
    assert "discovery_strategy_nav" not in expected


def test_reverted_discovery_tables_are_archived_without_drop() -> None:
    migration = (
        ROOT
        / "src"
        / "ai_hedge"
        / "db"
        / "migrations"
        / "016_archive_reverted_discovery_tables.sql"
    ).read_text(encoding="utf-8")

    for table in (
        "discovery_strategy_nav",
        "discovery_strategy_holdings",
        "discovery_benchmark_nav",
    ):
        assert table in migration
    assert "SET SCHEMA archive" in migration
    assert "DROP TABLE" not in migration.upper()


def test_classify_core_state_refuses_partial_schema() -> None:
    assert classify_core_state(set()) == "empty"
    assert classify_core_state(set(CORE_TABLES)) == "complete"
    assert classify_core_state({"users", "reports"}) == "partial"
    assert classify_core_state({"schema_migrations"}) == "partial"
    assert classify_core_state({"unrelated_extension_table"}) == "empty"


def test_audit_failures_keep_unexpected_tables_as_separate_policy() -> None:
    payload = {
        "migrations": {"applied": ["001.sql"], "pending": []},
        "missing_tables": [],
        "unexpected_tables": ["legacy_experiment"],
        "report_integrity": {
            "reports_without_artifact": 0,
            "orphan_artifacts": 0,
        },
    }

    assert audit_failures(payload) == []
    assert audit_failures(payload, fail_on_unexpected=True) == ["1 unexpected table(s)"]
