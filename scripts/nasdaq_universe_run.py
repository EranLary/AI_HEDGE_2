from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4


LEASE_SECONDS = 15 * 60
HEARTBEAT_SECONDS = 30
POLL_SECONDS = 5


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid(value: object) -> str:
    return str(UUID(str(value or "").strip()))


def _read_status(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_status(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


@dataclass(frozen=True)
class ClaimedItem:
    ticker: str
    company_name: str
    attempts: int
    worker_id: str


def _counts(conn, run_id: str) -> tuple[int, int, int, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) FILTER (WHERE status = 'completed')::int,
                   count(*) FILTER (WHERE status = 'failed')::int,
                   count(*) FILTER (WHERE status = 'running')::int,
                   count(*) FILTER (WHERE status = 'pending')::int
              FROM nasdaq_universe_run_items
             WHERE run_id = %s::uuid;
            """,
            (run_id,),
        )
        row = cur.fetchone() or (0, 0, 0, 0)
    return (
        int(row[0] or 0),
        int(row[1] or 0),
        int(row[2] or 0),
        int(row[3] or 0),
    )


def _update_counts(conn, run_id: str) -> tuple[int, int, int, int]:
    completed, failed, running, pending = _counts(conn, run_id)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE nasdaq_universe_runs
               SET completed_count = %s,
                   failed_count = %s,
                   heartbeat_at = now()
             WHERE id = %s::uuid;
            """,
            (completed, failed, run_id),
        )
    conn.commit()
    return completed, failed, running, pending


def _heartbeat(run_id: str, runner_prefix: str, stop: threading.Event) -> None:
    from ai_hedge.db.connection import get_conn

    while not stop.wait(HEARTBEAT_SECONDS):
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE nasdaq_universe_runs
                           SET heartbeat_at = now()
                         WHERE id = %s::uuid
                           AND status IN ('queued', 'running');
                        """,
                        (run_id,),
                    )
                    cur.execute(
                        """
                        UPDATE nasdaq_universe_run_items
                           SET heartbeat_at = now(),
                               lease_expires_at = now() + (%s * interval '1 second')
                         WHERE run_id = %s::uuid
                           AND status = 'running'
                           AND worker_id LIKE %s;
                        """,
                        (LEASE_SECONDS, run_id, f"{runner_prefix}:%"),
                    )
                conn.commit()
        except Exception:
            pass


def _release_has_full_coverage(conn, release_id: str, snapshot: object) -> bool:
    expected = {
        str(row.get("ticker") or "").strip().upper()
        for row in (snapshot if isinstance(snapshot, list) else [])
        if isinstance(row, dict) and str(row.get("ticker") or "").strip()
    }
    if not expected:
        return False
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ticker
              FROM reports
             WHERE workspace = 'nasdaq100'
               AND release_id = %s::uuid
               AND deleted_at IS NULL;
            """,
            (release_id,),
        )
        actual = {str(row[0] or "").strip().upper() for row in cur.fetchall()}
    return expected.issubset(actual)


def _load_and_start_run(conn, run_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, release_id::text,
                   requested_by_user_id::text, requested_by_email,
                   requested_mode, effective_mode, status,
                   universe_snapshot, universe_count, requested_count,
                   max_attempts, concurrency,
                   estimated_cost_per_attempt_usd::float8,
                   estimated_cost_usd::float8,
                   observed_cost_usd::float8,
                   budget_limit_usd::float8,
                   stop_requested_at
              FROM nasdaq_universe_runs
             WHERE id = %s::uuid
             FOR UPDATE;
            """,
            (run_id,),
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"Nasdaq universe run {run_id} does not exist")
        columns = [desc.name for desc in cur.description]
        run = dict(zip(columns, row))
        if str(run.get("status")) not in {"queued", "running"}:
            raise RuntimeError(f"Nasdaq universe run is already {run.get('status')}")
        cur.execute(
            """
            UPDATE nasdaq_universe_runs
               SET status = 'running',
                   started_at = coalesce(started_at, now()),
                   finished_at = NULL,
                   heartbeat_at = now(),
                   error = ''
             WHERE id = %s::uuid;
            """,
            (run_id,),
        )
    conn.commit()
    return run


def _claim_next_item(
    run_id: str,
    worker_id: str,
    *,
    enforce_window: bool,
) -> tuple[str, ClaimedItem | None]:
    from ai_hedge.db.connection import get_conn
    from ai_hedge.nasdaq_execution import budget_allows_attempt, is_preferred_off_peak_utc

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT status, stop_requested_at, max_attempts,
                       estimated_cost_per_attempt_usd::float8,
                       estimated_cost_usd::float8, budget_limit_usd::float8
                  FROM nasdaq_universe_runs
                 WHERE id = %s::uuid
                 FOR UPDATE;
                """,
                (run_id,),
            )
            row = cur.fetchone()
            if not row or str(row[0]) not in {"queued", "running"}:
                return "done", None

            max_attempts = max(1, int(row[2] or 3))
            per_attempt = float(row[3] or 2.0)
            estimated = float(row[4] or 0.0)
            budget = float(row[5] or 300.0)
            # A process can be interrupted after the report transaction commits
            # but before its local status file is read. Reconcile that durable
            # report before deciding to retry, so recovery never pays to analyze
            # an already-published ticker again.
            cur.execute(
                """
                WITH existing AS (
                    SELECT DISTINCT ON (report.ticker) report.ticker, report.id
                      FROM reports report
                      JOIN nasdaq_universe_runs run ON run.release_id = report.release_id
                     WHERE run.id = %s::uuid
                       AND report.workspace = 'nasdaq100'
                       AND report.deleted_at IS NULL
                     ORDER BY report.ticker, report.generated_at DESC
                )
                UPDATE nasdaq_universe_run_items item
                   SET status = 'completed', report_id = existing.id,
                       finished_at = coalesce(item.finished_at, now()),
                       worker_id = NULL, lease_expires_at = NULL,
                       heartbeat_at = now(), last_error = ''
                  FROM existing
                 WHERE item.run_id = %s::uuid
                   AND item.ticker = existing.ticker
                   AND (
                       item.status = 'pending'
                       OR (
                           item.status = 'running'
                           AND coalesce(item.lease_expires_at, '-infinity'::timestamptz) < now()
                       )
                   );
                """,
                (run_id, run_id),
            )
            cur.execute(
                """
                UPDATE nasdaq_universe_run_items
                   SET status = 'failed', finished_at = now(),
                       worker_id = NULL, lease_expires_at = NULL,
                       last_error = CASE WHEN last_error = ''
                           THEN 'Maximum ticker attempts exhausted.'
                           ELSE last_error END
                 WHERE run_id = %s::uuid
                   AND attempts >= %s
                   AND (
                       status = 'pending'
                       OR (status = 'running' AND coalesce(lease_expires_at, '-infinity'::timestamptz) < now())
                   );
                """,
                (run_id, max_attempts),
            )

            cur.execute(
                """
                SELECT count(*) FILTER (WHERE status IN ('pending', 'running'))::int
                  FROM nasdaq_universe_run_items
                 WHERE run_id = %s::uuid;
                """,
                (run_id,),
            )
            live_count = int((cur.fetchone() or (0,))[0] or 0)
            if not live_count:
                return "done", None
            if row[1] is not None:
                return "stop_requested", None
            if enforce_window and not is_preferred_off_peak_utc():
                return "window_closed", None

            cur.execute(
                """
                SELECT ticker, coalesce(company_name, ticker), attempts
                  FROM nasdaq_universe_run_items
                 WHERE run_id = %s::uuid
                   AND attempts < %s
                   AND (
                       (status = 'pending' AND next_attempt_at <= now())
                       OR (status = 'running' AND coalesce(lease_expires_at, '-infinity'::timestamptz) < now())
                   )
                 ORDER BY next_attempt_at, ticker
                 FOR UPDATE SKIP LOCKED
                 LIMIT 1;
                """,
                (run_id, max_attempts),
            )
            item = cur.fetchone()
            if not item:
                return ("waiting" if live_count else "done"), None
            if not budget_allows_attempt(estimated, per_attempt, budget):
                return "budget_exhausted", None

            ticker = str(item[0] or "").strip().upper()
            company_name = str(item[1] or ticker)
            attempts = int(item[2] or 0) + 1
            cur.execute(
                """
                UPDATE nasdaq_universe_run_items
                   SET status = 'running', attempts = %s,
                       worker_id = %s, heartbeat_at = now(),
                       lease_expires_at = now() + (%s * interval '1 second'),
                       started_at = coalesce(started_at, now()),
                       finished_at = NULL, last_error = '',
                       estimated_cost_usd = estimated_cost_usd + %s
                 WHERE run_id = %s::uuid AND ticker = %s;
                """,
                (attempts, worker_id, LEASE_SECONDS, per_attempt, run_id, ticker),
            )
            cur.execute(
                """
                UPDATE nasdaq_universe_runs
                   SET status = 'running', heartbeat_at = now(),
                       estimated_cost_usd = estimated_cost_usd + %s
                 WHERE id = %s::uuid;
                """,
                (per_attempt, run_id),
            )
        conn.commit()
    return "claimed", ClaimedItem(ticker, company_name, attempts, worker_id)


def _finish_attempt(
    run_id: str,
    item: ClaimedItem,
    *,
    report_id: str | None,
    last_error: str,
    observed_cost_usd: float,
    max_attempts: int,
) -> None:
    from ai_hedge.db.connection import get_conn
    from ai_hedge.nasdaq_execution import retry_delay_seconds

    with get_conn() as conn:
        with conn.cursor() as cur:
            if report_id:
                cur.execute(
                    """
                    UPDATE nasdaq_universe_run_items
                       SET status = 'completed', report_id = %s::uuid,
                           finished_at = now(), last_error = '',
                           worker_id = NULL, lease_expires_at = NULL,
                           heartbeat_at = now(), observed_cost_usd = observed_cost_usd + %s
                     WHERE run_id = %s::uuid AND ticker = %s AND worker_id = %s;
                    """,
                    (report_id, observed_cost_usd, run_id, item.ticker, item.worker_id),
                )
            elif item.attempts >= max_attempts:
                cur.execute(
                    """
                    UPDATE nasdaq_universe_run_items
                       SET status = 'failed', finished_at = now(), last_error = %s,
                           worker_id = NULL, lease_expires_at = NULL,
                           heartbeat_at = now(), observed_cost_usd = observed_cost_usd + %s
                     WHERE run_id = %s::uuid AND ticker = %s AND worker_id = %s;
                    """,
                    (last_error[:4000], observed_cost_usd, run_id, item.ticker, item.worker_id),
                )
            else:
                delay = retry_delay_seconds(item.attempts)
                cur.execute(
                    """
                    UPDATE nasdaq_universe_run_items
                       SET status = 'pending', finished_at = NULL, last_error = %s,
                           worker_id = NULL, lease_expires_at = NULL,
                           heartbeat_at = now(),
                           next_attempt_at = now() + (%s * interval '1 second'),
                           observed_cost_usd = observed_cost_usd + %s
                     WHERE run_id = %s::uuid AND ticker = %s AND worker_id = %s;
                    """,
                    (last_error[:4000], delay, observed_cost_usd, run_id, item.ticker, item.worker_id),
                )
            # Only the current lease owner may finalize an attempt. If a stale
            # process returns after its lease was reclaimed, its result and
            # observed cost must not overwrite or double-count the new owner.
            finalized = cur.rowcount > 0
            if finalized:
                cur.execute(
                    """
                    UPDATE nasdaq_universe_runs
                       SET observed_cost_usd = observed_cost_usd + %s,
                           heartbeat_at = now()
                     WHERE id = %s::uuid;
                    """,
                    (observed_cost_usd, run_id),
                )
        conn.commit()
        _update_counts(conn, run_id)


def _execute_attempt(
    *,
    root: Path,
    run_id: str,
    release_id: str,
    user_id: str | None,
    item: ClaimedItem,
    max_attempts: int,
) -> None:
    from ai_hedge.nasdaq_execution import configured_ticker_timeout_seconds

    site_script = root / "scripts" / "site_run.py"
    src = root / "src"
    runs_root = root / "outputs" / "_site_runs"
    job_id = f"N100_{item.ticker}_{run_id[:8]}_{item.attempts}"
    job_dir = runs_root / job_id
    status_file = job_dir / "_status.json"
    started_at = _utc_now()
    _write_status(
        status_file,
        {
            "job_id": job_id,
            "ticker": item.ticker,
            "status": "queued",
            "created_at": started_at,
            "started_at": None,
            "finished_at": None,
            "output_dir": str(job_dir),
            "progress_file": str(job_dir / "_progress.log"),
            "user_id": user_id,
            "workspace": "nasdaq100",
            "release_id": release_id,
            "batch_id": run_id,
            "llm_total_estimated": 45,
            "llm_completed": 0,
            "observed_cost_usd": 0.0,
            "error": "",
            "report_id": None,
        },
    )
    command = [
        sys.executable,
        str(site_script),
        "--ticker",
        item.ticker,
        "--output-dir",
        str(job_dir),
        "--status-file",
        str(status_file),
        "--workspace",
        "nasdaq100",
        "--release-id",
        release_id,
        "--batch-id",
        run_id,
    ]
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONPATH": str(src)}
    completed_process = subprocess.run(
        command,
        cwd=root,
        env=env,
        check=False,
        timeout=configured_ticker_timeout_seconds(),
    )
    child_status = _read_status(status_file)
    candidate_report_id = str(child_status.get("report_id") or "").strip()
    report_id: str | None = None
    if completed_process.returncode == 0 and candidate_report_id:
        try:
            report_id = _uuid(candidate_report_id)
        except Exception:
            report_id = None
    last_error = ""
    if not report_id:
        last_error = str(
            child_status.get("error")
            or child_status.get("persistence_error")
            or f"Ticker process exited with code {completed_process.returncode}."
        ).strip()
    try:
        observed_cost = max(0.0, float(child_status.get("observed_cost_usd") or 0.0))
    except (TypeError, ValueError):
        observed_cost = 0.0
    _finish_attempt(
        run_id,
        item,
        report_id=report_id,
        last_error=last_error,
        observed_cost_usd=observed_cost,
        max_attempts=max_attempts,
    )


def _worker_loop(
    *,
    root: Path,
    run_id: str,
    release_id: str,
    user_id: str | None,
    max_attempts: int,
    runner_prefix: str,
    slot: int,
    enforce_window: bool,
    halt: threading.Event,
    halt_reason: dict[str, str],
    reason_lock: threading.Lock,
) -> None:
    worker_id = f"{runner_prefix}:{slot}"
    while not halt.is_set():
        state, item = _claim_next_item(run_id, worker_id, enforce_window=enforce_window)
        if state == "claimed" and item is not None:
            try:
                _execute_attempt(
                    root=root,
                    run_id=run_id,
                    release_id=release_id,
                    user_id=user_id,
                    item=item,
                    max_attempts=max_attempts,
                )
            except Exception as exc:
                _finish_attempt(
                    run_id,
                    item,
                    report_id=None,
                    last_error=f"{type(exc).__name__}: {exc}",
                    observed_cost_usd=0.0,
                    max_attempts=max_attempts,
                )
            continue
        if state == "waiting":
            halt.wait(POLL_SECONDS)
            continue
        if state in {"stop_requested", "window_closed", "budget_exhausted"}:
            with reason_lock:
                halt_reason.setdefault("value", state)
            halt.set()
        return


def _fail_remaining_dispatchable(run_id: str, reason: str) -> None:
    from ai_hedge.db.connection import get_conn

    messages = {
        "stop_requested": "Stopped by the administrator; rerun within seven days to continue.",
        "window_closed": "The preferred off-peak execution window closed; rerun within seven days to continue.",
        "budget_exhausted": "The universe-run budget was reached; rerun within seven days to continue.",
        "interrupted": "The universe runner was interrupted; rerun within seven days to continue.",
    }
    message = messages.get(reason, messages["interrupted"])
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE nasdaq_universe_run_items
                   SET status = 'failed', finished_at = now(), last_error = %s,
                       worker_id = NULL, lease_expires_at = NULL, heartbeat_at = now()
                 WHERE run_id = %s::uuid
                   AND (
                       status = 'pending'
                       OR (status = 'running' AND coalesce(lease_expires_at, '-infinity'::timestamptz) < now())
                   );
                """,
                (message, run_id),
            )
        conn.commit()
        _update_counts(conn, run_id)


def _finalize(run_id: str, run: dict[str, Any], reason: str = "") -> tuple[str, int, int]:
    from ai_hedge.db.connection import get_conn

    release_id = _uuid(run.get("release_id"))
    with get_conn() as conn:
        completed, failed, running, pending = _counts(conn, run_id)
        if running or pending:
            return "running", completed, failed
        final_status = "completed" if failed == 0 else ("partial" if completed else "failed")
        coverage_complete = final_status == "completed" and _release_has_full_coverage(
            conn,
            release_id,
            run.get("universe_snapshot"),
        )
        reason_messages = {
            "stop_requested": "Run stopped after active stocks finished. Completed reports remain available; rerun within seven days to continue.",
            "window_closed": "The off-peak window closed. Completed reports remain available; rerun within seven days to continue.",
            "budget_exhausted": "The run budget was reached. Completed reports remain available; rerun within seven days to continue.",
            "interrupted": "Universe runner interrupted. Completed reports remain available; rerun within seven days to continue.",
        }
        error = reason_messages.get(reason, "")
        if not error and final_status == "partial":
            error = "Some tickers exhausted their retries. Completed reports are available; rerun within seven days to continue."
        if not error and final_status == "failed":
            error = "All requested tickers failed after retries. Rerun within seven days to continue."
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE nasdaq_universe_runs
                   SET status = %s, completed_count = %s, failed_count = %s,
                       finished_at = now(), heartbeat_at = now(), error = %s
                 WHERE id = %s::uuid;
                """,
                (final_status, completed, failed, error[:4000], run_id),
            )
            if final_status == "completed":
                cur.execute(
                    """
                    UPDATE report_releases
                       SET status = 'active',
                           activated_at = coalesce(activated_at, now()),
                           coverage_complete = %s
                     WHERE id = %s::uuid;
                    """,
                    (coverage_complete, release_id),
                )
        conn.commit()
    return final_status, completed, failed


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a durable Nasdaq-100 universe worker pool.")
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    run_id = _uuid(args.run_id)

    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    from ai_hedge.db.connection import get_conn
    from ai_hedge.nasdaq_execution import enforce_execution_window

    keepalive_stop: threading.Event | None = None
    keepalive_thread: threading.Thread | None = None
    heartbeat_stop = threading.Event()
    heartbeat_thread: threading.Thread | None = None
    halt = threading.Event()
    halt_reason: dict[str, str] = {}
    reason_lock = threading.Lock()
    run: dict[str, Any] = {}
    runner_prefix = f"{socket.gethostname()}-{os.getpid()}-{uuid4().hex[:8]}"

    try:
        from site_run import _maybe_start_preview_keepalive

        keepalive_stop, keepalive_thread = _maybe_start_preview_keepalive()
    except Exception:
        pass

    try:
        with get_conn() as conn:
            run = _load_and_start_run(conn, run_id)

        release_id = _uuid(run.get("release_id"))
        user_id = str(run.get("requested_by_user_id") or "").strip() or None
        max_attempts = max(1, int(run.get("max_attempts") or 3))
        concurrency = max(1, min(12, int(run.get("concurrency") or 4)))

        heartbeat_thread = threading.Thread(
            target=_heartbeat,
            args=(run_id, runner_prefix, heartbeat_stop),
            name=f"nasdaq-heartbeat-{run_id[:8]}",
            daemon=True,
        )
        heartbeat_thread.start()

        with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="nasdaq-ticker") as pool:
            futures = [
                pool.submit(
                    _worker_loop,
                    root=root,
                    run_id=run_id,
                    release_id=release_id,
                    user_id=user_id,
                    max_attempts=max_attempts,
                    runner_prefix=runner_prefix,
                    slot=slot,
                    enforce_window=enforce_execution_window(),
                    halt=halt,
                    halt_reason=halt_reason,
                    reason_lock=reason_lock,
                )
                for slot in range(concurrency)
            ]
            for future in futures:
                future.result()

        reason = halt_reason.get("value", "")
        if reason:
            _fail_remaining_dispatchable(run_id, reason)
        final_status, _completed, failed = _finalize(run_id, run, reason)
        return 0 if final_status == "completed" and failed == 0 else 1
    except KeyboardInterrupt:
        halt.set()
        _fail_remaining_dispatchable(run_id, "interrupted")
        _finalize(run_id, run, "interrupted")
        return 130
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        try:
            _fail_remaining_dispatchable(run_id, "interrupted")
            _finalize(run_id, run, "interrupted")
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE nasdaq_universe_runs
                           SET error = %s, heartbeat_at = now()
                         WHERE id = %s::uuid;
                        """,
                        (error[:4000], run_id),
                    )
                conn.commit()
        except Exception:
            pass
        print(error, file=sys.stderr)
        traceback.print_exc(limit=8)
        return 1
    finally:
        halt.set()
        heartbeat_stop.set()
        if heartbeat_thread is not None:
            heartbeat_thread.join(timeout=2)
        if keepalive_stop is not None:
            keepalive_stop.set()
        if keepalive_thread is not None:
            keepalive_thread.join(timeout=2)


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    raise SystemExit(main())
