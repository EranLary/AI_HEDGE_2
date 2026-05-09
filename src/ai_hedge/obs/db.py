"""Postgres I/O for the obs platform.

Reads ``OBS_DATABASE_URL`` (falls back to ``DATABASE_URL_UNPOOLED``).
All writes are best-effort: failures are logged to stderr and never raise
back into the pipeline. The agent's job is primary; observability is secondary.
"""
from __future__ import annotations

import hashlib
import os
import sys
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Optional

import psycopg

_lock = threading.Lock()


def _resolve_url() -> Optional[str]:
    return (
        os.environ.get("OBS_DATABASE_URL")
        or os.environ.get("DATABASE_URL_UNPOOLED")
        or None
    )


@contextmanager
def _conn():
    url = _resolve_url()
    if not url:
        yield None
        return
    try:
        with psycopg.connect(url, autocommit=True, connect_timeout=10) as c:
            yield c
    except Exception as exc:  # noqa: BLE001
        print(f"[obs.db] connection failed: {exc}", file=sys.stderr)
        yield None


def _log_err(where: str, exc: Exception) -> None:
    print(f"[obs.db.{where}] {type(exc).__name__}: {exc}", file=sys.stderr)


def insert_run(
    *,
    ticker: str,
    user_id: Optional[str] = None,
    source: str = "cli",
    source_run_id: Optional[str] = None,
) -> Optional[str]:
    """Insert a row into obs_runs. Returns the run id (uuid str) or None on failure."""
    # OBS_RUN_SOURCE_LABEL lets per-PR site previews tag rows on the prod obs DB
    # (e.g. "preview-pr-123") so they are distinguishable from real cli/site/bot runs.
    source_override = os.environ.get("OBS_RUN_SOURCE_LABEL", "").strip()
    effective_source = source_override or source
    with _conn() as c:
        if c is None:
            return None
        try:
            with c.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO obs_runs (ticker, user_id, source, source_run_id, status, started_at)
                    VALUES (%s, %s, %s, %s, 'running', now())
                    RETURNING id::text
                    """,
                    (ticker, user_id, effective_source, source_run_id),
                )
                row = cur.fetchone()
                return row[0] if row else None
        except Exception as exc:  # noqa: BLE001
            _log_err("insert_run", exc)
            return None


def finalize_run_row(
    *,
    run_id: str,
    status: str,
    error_message: Optional[str] = None,
    duration_ms: Optional[int] = None,
) -> None:
    """Set ended_at + status on obs_runs and roll up totals from obs_calls."""
    if not run_id:
        return
    with _conn() as c:
        if c is None:
            return
        try:
            with c.cursor() as cur:
                cur.execute(
                    """
                    UPDATE obs_runs
                       SET status         = %s,
                           ended_at       = now(),
                           duration_ms    = %s,
                           error_message  = %s,
                           total_calls    = (SELECT count(*) FROM obs_calls WHERE run_id = %s),
                           total_tokens_in  = COALESCE((SELECT sum(tokens_in)  FROM obs_calls WHERE run_id = %s), 0),
                           total_tokens_out = COALESCE((SELECT sum(tokens_out) FROM obs_calls WHERE run_id = %s), 0),
                           total_cost_usd   = COALESCE((SELECT sum(cost_usd)   FROM obs_calls WHERE run_id = %s), 0)
                     WHERE id = %s
                    """,
                    (status, duration_ms, error_message, run_id, run_id, run_id, run_id, run_id),
                )
        except Exception as exc:  # noqa: BLE001
            _log_err("finalize_run", exc)


def _next_sequence(cur, run_id: str) -> int:
    cur.execute(
        "SELECT COALESCE(max(sequence), -1) + 1 FROM obs_calls WHERE run_id = %s",
        (run_id,),
    )
    row = cur.fetchone()
    return int(row[0]) if row else 0


def insert_call(
    *,
    run_id: str,
    parent_id: Optional[str],
    stage: str,
    persona: Optional[str],
    call_site: Optional[str],
    model_requested: str,
    model_actual: Optional[str],
    temperature: float,
    prompt: str,
    response: Optional[str],
    reasoning: Optional[str],
    tokens_in: Optional[int],
    tokens_out: Optional[int],
    tokens_total: Optional[int],
    cost_usd: Optional[float],
    latency_ms: int,
    retries: int,
    status: str,
    error_class: Optional[str],
    error_message: Optional[str],
    started_at: datetime,
    ended_at: datetime,
) -> Optional[str]:
    """Insert a single LLM call. Returns call id or None on failure."""
    sha = hashlib.sha256((prompt or "").encode("utf-8")).digest()
    with _conn() as c:
        if c is None:
            return None
        try:
            with c.cursor() as cur:
                with _lock:  # serialize sequence assignment per process
                    seq = _next_sequence(cur, run_id)
                    cur.execute(
                        """
                        INSERT INTO obs_calls (
                            run_id, parent_id, sequence, stage, persona, call_site,
                            model_requested, model_actual, temperature,
                            prompt, prompt_sha256, response, reasoning,
                            tokens_in, tokens_out, tokens_total, cost_usd,
                            latency_ms, retries, status, error_class, error_message,
                            started_at, ended_at
                        )
                        VALUES (
                            %s, %s, %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, %s,
                            %s, %s, %s, %s, %s,
                            %s, %s
                        )
                        RETURNING id::text
                        """,
                        (
                            run_id, parent_id, seq, stage, persona, call_site,
                            model_requested, model_actual, temperature,
                            prompt, sha, response, reasoning,
                            tokens_in, tokens_out, tokens_total, cost_usd,
                            latency_ms, retries, status, error_class, error_message,
                            started_at, ended_at,
                        ),
                    )
                    row = cur.fetchone()
                    return row[0] if row else None
        except Exception as exc:  # noqa: BLE001
            _log_err("insert_call", exc)
            return None
