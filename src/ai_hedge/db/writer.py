from __future__ import annotations

import os
import time
import sys
from pathlib import Path


def find_report_id_by_source_run_id(
    source_run_id: str,
    *,
    source: str = "site",
    ticker: str | None = None,
) -> str | None:
    """
    Resolve an existing report row by source_run_id (and optional ticker).
    Returns the newest report id if found, else None.
    """
    if not source_run_id:
        return None
    if not (os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")):
        return None
    try:
        from ai_hedge.db.connection import get_conn
    except ImportError:
        return None

    sql = """
    SELECT id::text
      FROM reports
     WHERE source = %s
       AND source_run_id = %s
    """
    params: list[object] = [source, source_run_id]
    if ticker:
        sql += " AND ticker = %s"
        params.append(str(ticker).upper())
    sql += " ORDER BY generated_at DESC LIMIT 1;"
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                row = cur.fetchone()
                return str(row[0]) if row else None
    except Exception:
        return None


def write_run_to_db(
    output_dir: str | Path,
    *,
    source: str,
    max_attempts: int = 1,
    retry_backoff_seconds: float = 1.5,
) -> str | None:
    """
    Best-effort DB write at the end of a successful run.

    - No-op (returns None) if DATABASE_URL_UNPOOLED / DATABASE_URL is unset.
    - Catches and logs all errors so DB problems don't kill a successful run.
    - Returns the inserted report_id on success, or None.
    """
    if not (os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")):
        return None

    try:
        from ai_hedge.db.connection import get_conn
        from ai_hedge.db.repository import insert_report, upsert_ticker
        from ai_hedge.db.transform import ticker_dir_to_row
    except ImportError as exc:
        print(f"[db.writer] skipping (import failed): {exc}", file=sys.stderr)
        return None

    try:
        bundle = ticker_dir_to_row(Path(output_dir), source=source)
    except Exception as exc:  # noqa: BLE001
        print(
            f"[db.writer] skipping ({type(exc).__name__}: {exc})",
            file=sys.stderr,
        )
        return None

    if bundle is None:
        print(
            f"[db.writer] skipping {output_dir}: no dashboard/analysis found",
            file=sys.stderr,
        )
        return None

    attempts = max(1, int(max_attempts or 1))
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with get_conn() as conn:
                upsert_ticker(conn, bundle["ticker_row"])
                report_id, was_inserted = insert_report(
                    conn, bundle["report_row"], bundle["artifact_row"]
                )
                conn.commit()
            state = "inserted" if was_inserted else "duplicate"
            print(
                f"[db.writer] {state} {bundle['report_row']['ticker']} -> {report_id}",
                file=sys.stderr,
            )
            return report_id
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            print(
                f"[db.writer] DB write attempt {attempt}/{attempts} failed for "
                f"{bundle['report_row']['ticker']}: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
            if attempt < attempts:
                sleep_s = max(0.1, float(retry_backoff_seconds)) * attempt
                time.sleep(sleep_s)
                continue
            break

    if last_exc is not None:
        print(
            f"[db.writer] DB write failed permanently for {bundle['report_row']['ticker']}: "
            f"{type(last_exc).__name__}: {last_exc}",
            file=sys.stderr,
        )
    return None
