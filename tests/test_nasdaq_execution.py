from __future__ import annotations

from datetime import datetime, timezone

from ai_hedge.nasdaq_execution import (
    budget_allows_attempt,
    configured_budget_limit_usd,
    configured_concurrency,
    configured_ticker_timeout_seconds,
    is_preferred_off_peak_utc,
    retry_delay_seconds,
)
from scripts.nasdaq_universe_run import (
    _release_has_full_coverage,
    _snapshot_has_full_coverage,
    _terminal_run_status,
)


def _utc(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, 21, hour, minute, tzinfo=timezone.utc)


def test_preferred_window_uses_utc_and_crosses_midnight() -> None:
    assert is_preferred_off_peak_utc(_utc(10, 0))
    assert is_preferred_off_peak_utc(_utc(23, 59))
    assert is_preferred_off_peak_utc(_utc(0, 59))
    assert not is_preferred_off_peak_utc(_utc(1, 0))
    assert not is_preferred_off_peak_utc(_utc(9, 59))


def test_retry_backoff_is_bounded_and_jittered(monkeypatch) -> None:
    monkeypatch.setattr("ai_hedge.nasdaq_execution.random.randint", lambda _low, high: high)
    assert retry_delay_seconds(1) == 75
    assert retry_delay_seconds(2) == 150
    assert retry_delay_seconds(5) == 900
    assert retry_delay_seconds(20) == 900


def test_budget_guard_includes_the_next_attempt() -> None:
    assert budget_allows_attempt(598, 2, 600)
    assert not budget_allows_attempt(599, 2, 600)


def test_default_budget_limit_is_600_usd(monkeypatch) -> None:
    monkeypatch.delenv("NASDAQ_RUN_BUDGET_USD", raising=False)
    assert configured_budget_limit_usd() == 600.0


def test_default_concurrency_is_ten_with_a_twelve_ticker_safety_cap(monkeypatch) -> None:
    monkeypatch.delenv("NASDAQ_RUN_CONCURRENCY", raising=False)
    assert configured_concurrency() == 10
    monkeypatch.setenv("NASDAQ_RUN_CONCURRENCY", "999")
    assert configured_concurrency() == 12


def test_ticker_timeout_is_bounded(monkeypatch) -> None:
    monkeypatch.setenv("NASDAQ_TICKER_TIMEOUT_SECONDS", "60")
    assert configured_ticker_timeout_seconds() == 30 * 60
    monkeypatch.setenv("NASDAQ_TICKER_TIMEOUT_SECONDS", "999999")
    assert configured_ticker_timeout_seconds() == 6 * 60 * 60


def test_release_coverage_accepts_any_saved_alias_for_an_issuer() -> None:
    snapshot = [
        {
            "ticker": "GOOGL",
            "companyName": "Alphabet Inc. Class A Common Stock",
            "aliases": ["GOOGL", "GOOG"],
        },
        {"ticker": "AAPL", "companyName": "Apple Inc.", "aliases": ["AAPL"]},
    ]

    assert _snapshot_has_full_coverage(snapshot, {"GOOG", "AAPL"})
    assert _snapshot_has_full_coverage(snapshot, {"GOOGL", "AAPL"})
    assert not _snapshot_has_full_coverage(snapshot, {"AAPL"})


def test_release_coverage_reads_the_current_release_and_recent_active_cohort() -> None:
    class Cursor:
        query = ""
        params = ()

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params) -> None:
            self.query = query
            self.params = params

        def fetchall(self):
            return [("AAPL",), ("MSFT",)]

    class Connection:
        cursor_instance = Cursor()

        def cursor(self):
            return self.cursor_instance

    snapshot = [
        {"ticker": "AAPL", "aliases": ["AAPL"]},
        {"ticker": "MSFT", "aliases": ["MSFT"]},
    ]
    conn = Connection()

    assert _release_has_full_coverage(conn, "5c4ea3b9-3817-4d8b-a291-598019958d85", snapshot)
    assert "report.release_id = %s::uuid" in conn.cursor_instance.query
    assert "report.available_at >= now() - interval '7 days'" in conn.cursor_instance.query
    assert "release.status IN ('running', 'active')" in conn.cursor_instance.query
    assert conn.cursor_instance.params == ("5c4ea3b9-3817-4d8b-a291-598019958d85",)


def test_terminal_run_status_distinguishes_stop_from_technical_failure() -> None:
    assert _terminal_run_status(completed=3, failed=0, stopped=93, reason="stop_requested") == "stopped"
    assert _terminal_run_status(completed=3, failed=3, stopped=0, reason="") == "partial"
    assert _terminal_run_status(completed=0, failed=3, stopped=0, reason="") == "failed"
