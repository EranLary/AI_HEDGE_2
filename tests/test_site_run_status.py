from __future__ import annotations

import threading

from scripts.site_run import (
    _estimate_total_llm_calls,
    _material_failure_error,
    _start_status_heartbeat,
    _status_heartbeat_seconds,
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


def test_site_run_heartbeat_defaults_and_caps(monkeypatch) -> None:
    monkeypatch.delenv("SITE_RUN_HEARTBEAT_SECONDS", raising=False)
    assert _status_heartbeat_seconds() == 30
    monkeypatch.setenv("SITE_RUN_HEARTBEAT_SECONDS", "invalid")
    assert _status_heartbeat_seconds() == 30
    monkeypatch.setenv("SITE_RUN_HEARTBEAT_SECONDS", "600")
    assert _status_heartbeat_seconds() == 300


def test_site_run_heartbeat_invokes_status_update(monkeypatch) -> None:
    fired = threading.Event()
    monkeypatch.setattr("scripts.site_run._status_heartbeat_seconds", lambda: 0.01)

    stop, thread = _start_status_heartbeat(fired.set)
    try:
        assert fired.wait(1)
    finally:
        stop.set()
        thread.join(timeout=1)
    assert not thread.is_alive()
