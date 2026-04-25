from __future__ import annotations

import os
import sys
from pathlib import Path


def write_run_to_db(output_dir: str | Path, *, source: str) -> str | None:
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

    try:
        with get_conn() as conn:
            upsert_ticker(conn, bundle["ticker_row"])
            report_id, was_inserted = insert_report(
                conn, bundle["report_row"], bundle["artifact_row"]
            )
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        print(
            f"[db.writer] DB write failed for {bundle['report_row']['ticker']}: "
            f"{type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return None

    state = "inserted" if was_inserted else "duplicate"
    print(
        f"[db.writer] {state} {bundle['report_row']['ticker']} -> {report_id}",
        file=sys.stderr,
    )
    return report_id
