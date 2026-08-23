from __future__ import annotations

from scripts.site_run import _material_failure_error, _terminal_progress


def test_failed_site_run_keeps_real_progress_below_complete() -> None:
    assert _terminal_progress(0, 45, successful=False) == (0, 0.0)
    assert _terminal_progress(3, 45, successful=False) == (3, 6.67)


def test_successful_site_run_can_close_an_estimated_progress_total() -> None:
    assert _terminal_progress(3, 45, successful=True) == (45, 100.0)


def test_material_failure_prefers_the_service_error_over_persistence_wording() -> None:
    assert _material_failure_error(
        {"status": "error", "error": "Yahoo info unavailable after 3 attempts"}
    ) == "Yahoo info unavailable after 3 attempts"
