from __future__ import annotations

import os
import time
import sys
from pathlib import Path
from uuid import UUID

from ai_hedge.workspaces import (
    ANALYSIS_WORKSPACE,
    NASDAQ100_WORKSPACE,
    normalize_workspace,
    normalize_workspace_release,
)


def _normalized_uuid(value: object) -> str | None:
    try:
        return str(UUID(str(value or "").strip()))
    except (ValueError, TypeError, AttributeError):
        return None


def attribute_report_to_user(
    report_id: str,
    user_id: str | None,
    *,
    workspace: str = ANALYSIS_WORKSPACE,
) -> bool:
    """Best-effort ownership attribution for a completed site report."""
    clean_report_id = _normalized_uuid(report_id)
    clean_user_id = _normalized_uuid(user_id)
    if not clean_report_id or not clean_user_id:
        return False
    if not (os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")):
        return False
    clean_workspace = normalize_workspace(workspace)
    try:
        from ai_hedge.db.connection import get_conn

        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE reports
                       SET user_id = %s
                     WHERE id = %s
                       AND workspace = %s
                       AND (user_id IS NULL OR user_id = %s)
                     RETURNING id;
                    """,
                    (clean_user_id, clean_report_id, clean_workspace, clean_user_id),
                )
                updated = cur.fetchone() is not None
            conn.commit()
        return updated
    except Exception:
        return False


def find_report_id_by_source_run_id(
    source_run_id: str,
    *,
    source: str = "site",
    ticker: str | None = None,
    workspace: str = ANALYSIS_WORKSPACE,
    release_id: str | None = None,
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

    clean_workspace = normalize_workspace(workspace)
    clean_release_id = _normalized_uuid(release_id)
    sql = """
    SELECT id::text
      FROM reports
     WHERE source = %s
       AND source_run_id = %s
       AND workspace = %s
    """
    params: list[object] = [source, source_run_id, clean_workspace]
    if clean_workspace == NASDAQ100_WORKSPACE:
        if not clean_release_id:
            return None
        sql += " AND release_id = %s::uuid"
        params.append(clean_release_id)
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
    r2_keys: dict | None = None,
    user_id: str | None = None,
    workspace: str = ANALYSIS_WORKSPACE,
    release_id: str | None = None,
) -> tuple[str | None, str | None]:
    """
    Best-effort DB write at the end of a successful run.

    Returns ``(report_id, error_message)``:

    - Success: ``(id, None)``
    - No-op (no DATABASE_URL, missing dashboard, etc.): ``(None, None)``
    - Insert failure: ``(None, "<exc-type>: <exc-msg>")`` carrying the last
      attempt's exception text so the caller can surface it to operators.

    Stderr printing is preserved for log-aggregation continuity. The
    swallowing pattern (best-effort, never kill a successful run) is
    unchanged; only the return shape is richer.

    ``r2_keys`` is persisted onto ``report_artifacts.r2_keys`` when provided.
    """
    if not (os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL")):
        return (None, None)

    try:
        clean_workspace, clean_release_id = normalize_workspace_release(workspace, release_id)
        from ai_hedge.db.connection import get_conn
        from ai_hedge.db.repository import insert_report, upsert_ticker
        from ai_hedge.db.transform import ticker_dir_to_row
    except ImportError as exc:
        msg = f"import failed: {exc}"
        print(f"[db.writer] skipping ({msg})", file=sys.stderr)
        return (None, msg)

    try:
        bundle = ticker_dir_to_row(
            Path(output_dir),
            source=source,
            workspace=clean_workspace,
            release_id=clean_release_id,
        )
    except Exception as exc:  # noqa: BLE001
        msg = f"{type(exc).__name__}: {exc}"
        print(f"[db.writer] skipping ({msg})", file=sys.stderr)
        return (None, msg)

    if bundle is None:
        print(
            f"[db.writer] skipping {output_dir}: no dashboard/analysis found",
            file=sys.stderr,
        )
        return (None, None)

    if r2_keys is not None:
        bundle["artifact_row"]["r2_keys"] = r2_keys
    bundle["report_row"]["user_id"] = _normalized_uuid(user_id)

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
            return (report_id, None)
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

    err_msg: str | None = None
    if last_exc is not None:
        err_msg = f"{type(last_exc).__name__}: {last_exc}"
        print(
            f"[db.writer] DB write failed permanently for "
            f"{bundle['report_row']['ticker']}: {err_msg}",
            file=sys.stderr,
        )
    return (None, err_msg)
