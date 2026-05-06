"""Run lifecycle helpers — bookend a ticker pipeline run with obs_runs rows."""
from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Optional

from . import db


@contextmanager
def start_run(*, ticker: str, source: str = "cli", source_run_id: Optional[str] = None,
              user_id: Optional[str] = None):
    """Insert obs_runs row, set RUN_ID context, finalize on exit (success or error).

    Yields the run_id (uuid string) or None if the DB is unreachable. The pipeline
    proceeds either way; obs is best-effort.

    Usage:
        with start_run(ticker="AAPL") as run_id:
            with llm_context(run_id=run_id):
                run_pipeline()
    """
    from .context import llm_context

    run_id = db.insert_run(ticker=ticker, source=source, source_run_id=source_run_id, user_id=user_id)
    started = time.perf_counter()
    if run_id is None:
        # DB unavailable — yield None and skip context. LLM calls won't be persisted
        # this run, but the pipeline still works.
        try:
            yield None
        except Exception:
            raise
        return

    status = "success"
    error_message: Optional[str] = None
    try:
        with llm_context(run_id=run_id):
            yield run_id
    except Exception as exc:
        status = "error"
        error_message = f"{type(exc).__name__}: {exc}"[:1000]
        raise
    finally:
        duration_ms = int((time.perf_counter() - started) * 1000)
        db.finalize_run_row(run_id=run_id, status=status, error_message=error_message,
                            duration_ms=duration_ms)


def finalize_run(run_id: str, *, status: str = "success", error_message: Optional[str] = None,
                 duration_ms: Optional[int] = None) -> None:
    """Direct finalize when start_run wasn't used as a context manager."""
    db.finalize_run_row(run_id=run_id, status=status, error_message=error_message,
                        duration_ms=duration_ms)
