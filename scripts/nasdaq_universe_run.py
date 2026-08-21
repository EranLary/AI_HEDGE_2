from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID


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


def _counts(conn, run_id: str) -> tuple[int, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) FILTER (WHERE status = 'completed')::int,
                   count(*) FILTER (WHERE status = 'failed')::int
              FROM nasdaq_universe_run_items
             WHERE run_id = %s::uuid;
            """,
            (run_id,),
        )
        row = cur.fetchone() or (0, 0)
    return int(row[0] or 0), int(row[1] or 0)


def _update_counts(conn, run_id: str) -> tuple[int, int]:
    completed, failed = _counts(conn, run_id)
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
    return completed, failed


def _heartbeat(run_id: str, stop: threading.Event) -> None:
    from ai_hedge.db.connection import get_conn

    while not stop.wait(30):
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a durable Nasdaq-100 universe batch.")
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    run_id = _uuid(args.run_id)

    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    from ai_hedge.db.connection import get_conn

    keepalive_stop: threading.Event | None = None
    keepalive_thread: threading.Thread | None = None
    heartbeat_stop = threading.Event()
    heartbeat_thread: threading.Thread | None = None
    run: dict[str, Any] = {}

    try:
        # Reuse the existing preview keepalive implementation so a long batch
        # survives after the initiating browser tab is closed.
        from site_run import _maybe_start_preview_keepalive

        keepalive_stop, keepalive_thread = _maybe_start_preview_keepalive()
    except Exception:
        pass

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id::text, release_id::text,
                           requested_by_user_id::text, requested_by_email,
                           requested_mode, effective_mode, status,
                           universe_snapshot, universe_count, requested_count,
                           max_attempts
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
                           heartbeat_at = now(),
                           error = ''
                     WHERE id = %s::uuid;
                    """,
                    (run_id,),
                )
            conn.commit()

        heartbeat_thread = threading.Thread(
            target=_heartbeat,
            args=(run_id, heartbeat_stop),
            name=f"nasdaq-heartbeat-{run_id[:8]}",
            daemon=True,
        )
        heartbeat_thread.start()

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT ticker, company_name, status, attempts
                      FROM nasdaq_universe_run_items
                     WHERE run_id = %s::uuid
                       AND status <> 'completed'
                     ORDER BY ticker;
                    """,
                    (run_id,),
                )
                items = [
                    {"ticker": row[0], "company_name": row[1], "status": row[2], "attempts": int(row[3] or 0)}
                    for row in cur.fetchall()
                ]

        max_attempts = max(1, int(run.get("max_attempts") or 3))
        release_id = _uuid(run.get("release_id"))
        user_id = str(run.get("requested_by_user_id") or "").strip() or None
        site_script = root / "scripts" / "site_run.py"
        runs_root = root / "outputs" / "_site_runs"

        for item in items:
            ticker = str(item["ticker"] or "").strip().upper()
            attempts = int(item["attempts"] or 0)
            last_error = ""
            report_id: str | None = None

            while attempts < max_attempts and not report_id:
                attempts += 1
                job_id = f"N100_{ticker}_{run_id[:8]}_{attempts}"
                job_dir = runs_root / job_id
                status_file = job_dir / "_status.json"
                started_at = _utc_now()
                _write_status(status_file, {
                    "job_id": job_id,
                    "ticker": ticker,
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
                    "error": "",
                    "report_id": None,
                })

                with get_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE nasdaq_universe_run_items
                               SET status = 'running', attempts = %s,
                                   started_at = coalesce(started_at, now()),
                                   finished_at = NULL, last_error = ''
                             WHERE run_id = %s::uuid AND ticker = %s;
                            """,
                            (attempts, run_id, ticker),
                        )
                        cur.execute(
                            "UPDATE nasdaq_universe_runs SET heartbeat_at = now() WHERE id = %s::uuid;",
                            (run_id,),
                        )
                    conn.commit()

                command = [
                    sys.executable,
                    str(site_script),
                    "--ticker", ticker,
                    "--output-dir", str(job_dir),
                    "--status-file", str(status_file),
                    "--workspace", "nasdaq100",
                    "--release-id", release_id,
                    "--batch-id", run_id,
                ]
                env = {
                    **os.environ,
                    "PYTHONUNBUFFERED": "1",
                    "PYTHONPATH": str(src),
                }
                completed_process = subprocess.run(command, cwd=root, env=env, check=False)
                child_status = _read_status(status_file)
                candidate_report_id = str(child_status.get("report_id") or "").strip()
                if completed_process.returncode == 0 and candidate_report_id:
                    try:
                        report_id = _uuid(candidate_report_id)
                    except Exception:
                        report_id = None
                if not report_id:
                    last_error = str(
                        child_status.get("error")
                        or child_status.get("persistence_error")
                        or f"Ticker process exited with code {completed_process.returncode}."
                    ).strip()

            with get_conn() as conn:
                with conn.cursor() as cur:
                    if report_id:
                        cur.execute(
                            """
                            UPDATE nasdaq_universe_run_items
                               SET status = 'completed', report_id = %s::uuid,
                                   finished_at = now(), last_error = ''
                             WHERE run_id = %s::uuid AND ticker = %s;
                            """,
                            (report_id, run_id, ticker),
                        )
                    else:
                        cur.execute(
                            """
                            UPDATE nasdaq_universe_run_items
                               SET status = 'failed', finished_at = now(), last_error = %s
                             WHERE run_id = %s::uuid AND ticker = %s;
                            """,
                            (last_error[:4000], run_id, ticker),
                        )
                conn.commit()
                _update_counts(conn, run_id)

        with get_conn() as conn:
            completed_count, failed_count = _counts(conn, run_id)
            final_status = "completed" if failed_count == 0 else ("partial" if completed_count else "failed")
            coverage_complete = final_status == "completed" and _release_has_full_coverage(
                conn,
                release_id,
                run.get("universe_snapshot"),
            )
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE nasdaq_universe_runs
                       SET status = %s, completed_count = %s, failed_count = %s,
                           finished_at = now(), heartbeat_at = now(),
                           error = CASE WHEN %s = 'partial'
                             THEN 'Some tickers exhausted their retries. Completed reports are available; rerun within seven days to continue.'
                             WHEN %s = 'failed'
                             THEN 'All requested tickers failed after retries. Rerun within seven days to continue.'
                             ELSE '' END
                     WHERE id = %s::uuid;
                    """,
                    (final_status, completed_count, failed_count, final_status, final_status, run_id),
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
        return 0 if failed_count == 0 else 1
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        try:
            from ai_hedge.db.connection import get_conn

            with get_conn() as conn:
                completed_count, failed_count = _counts(conn, run_id)
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE nasdaq_universe_runs
                           SET status = CASE WHEN %s > 0 THEN 'partial' ELSE 'failed' END,
                               completed_count = %s, failed_count = %s,
                               finished_at = now(), heartbeat_at = now(), error = %s
                         WHERE id = %s::uuid;
                        """,
                        (completed_count, completed_count, failed_count, error[:4000], run_id),
                    )
                conn.commit()
        except Exception:
            pass
        print(error, file=sys.stderr)
        traceback.print_exc(limit=8)
        return 1
    finally:
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

