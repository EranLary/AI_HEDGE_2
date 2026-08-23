from __future__ import annotations

from scripts.site_run import (
    _estimate_total_llm_calls,
    _material_failure_error,
    _terminal_progress,
)


def test_failed_site_run_keeps_real_progress_below_complete() -> None:
    assert _terminal_progress(0, 50, successful=False) == (0, 0.0)
    assert _terminal_progress(3, 50, successful=False) == (3, 6.0)


def test_successful_site_run_can_close_an_estimated_progress_total() -> None:
    assert _terminal_progress(3, 50, successful=True) == (50, 100.0)


def test_site_run_defaults_to_fifty_estimated_llm_calls(monkeypatch) -> None:
    monkeypatch.delenv("SITE_RUN_LLM_TOTAL_ESTIMATE", raising=False)
    assert _estimate_total_llm_calls() == 50
    monkeypatch.setenv("SITE_RUN_LLM_TOTAL_ESTIMATE", "invalid")
    assert _estimate_total_llm_calls() == 50


def test_material_failure_prefers_the_service_error_over_persistence_wording() -> None:
    assert _material_failure_error(
        {"status": "error", "error": "Yahoo info unavailable after 3 attempts"}
    ) == "Yahoo info unavailable after 3 attempts"
