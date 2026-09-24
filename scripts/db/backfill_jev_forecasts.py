"""Backfill Jev forecasts for persisted reports without rewriting report data."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from ai_hedge.db.connection import get_conn  # noqa: E402
from ai_hedge.jev import (  # noqa: E402
    JEV_MODEL_ID,
    QUESTION_VERSION,
    generate_and_store_report_forecast,
)


def _candidate_reports(workspace: str, limit: int, include_failed: bool) -> list[dict[str, str]]:
    workspace_filter = "" if workspace == "all" else "AND r.workspace = %s"
    params: list[object] = [] if workspace == "all" else [workspace]
    retry_filter = "AND (j.id IS NULL OR j.status = 'failed')" if include_failed else "AND j.id IS NULL"
    params.append(limit)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT r.id::text, r.ticker, r.workspace
                  FROM reports r
                  JOIN report_artifacts a ON a.report_id = r.id
                  LEFT JOIN report_jev_runs j
                    ON j.report_id = r.id
                   AND j.model_id = %s
                   AND j.question_version = %s
                 WHERE r.deleted_at IS NULL
                   {workspace_filter}
                   {retry_filter}
                 ORDER BY r.generated_at ASC
                 LIMIT %s;
                """,
                [JEV_MODEL_ID, QUESTION_VERSION, *params],
            )
            rows = cur.fetchall()
            return [
                {"report_id": str(row[0]), "ticker": str(row[1]), "workspace": str(row[2])}
                for row in rows
            ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", choices=("analysis", "nasdaq100", "all"), default="all")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--sleep-seconds", type=float, default=0.5)
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.dry_run and not str(os.environ.get("AI_GATEWAY_API_KEY", "")).strip():
        raise SystemExit("AI_GATEWAY_API_KEY is required")

    rows = _candidate_reports(args.workspace, max(1, args.limit), args.retry_failed)
    if args.dry_run:
        print(json.dumps({"candidates": rows, "count": len(rows)}, indent=2))
        return 0

    counts = {"completed": 0, "failed": 0, "already_claimed": 0, "missing_report": 0}
    for index, row in enumerate(rows, start=1):
        result = generate_and_store_report_forecast(row["report_id"], mode="retrospective")
        status = str(result.get("status") or "failed")
        counts[status] = counts.get(status, 0) + 1
        print(
            json.dumps(
                {
                    "progress": f"{index}/{len(rows)}",
                    "ticker": row["ticker"],
                    "workspace": row["workspace"],
                    "report_id": row["report_id"],
                    "status": status,
                    "error": result.get("error"),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        if index < len(rows) and args.sleep_seconds > 0:
            time.sleep(args.sleep_seconds)

    print(json.dumps({"processed": len(rows), "counts": counts}, indent=2))
    return 1 if counts.get("failed", 0) else 0


if __name__ == "__main__":
    raise SystemExit(main())
