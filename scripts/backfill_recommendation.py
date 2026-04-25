"""
Backfill reports.recommendation to one of:
    Strong Buy | Buy | Hold | Sell | Strong Sell

Source of truth: dashboard.decision_card.action (written by dashboard.py).
Fallback: normalize legacy LONG/SHORT/HOLD values stored in the column.
Rows whose source value can't be mapped are left untouched and reported.

Run:
    python scripts/backfill_recommendation.py            # apply
    python scripts/backfill_recommendation.py --dry-run  # preview only
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from ai_hedge.db.connection import DatabaseUrlMissing, get_conn  # noqa: E402

ALLOWED = ("Strong Buy", "Buy", "Hold", "Sell", "Strong Sell")

SELECT_SQL = """
SELECT r.id::text,
       r.ticker,
       r.recommendation                                           AS column_value,
       a.dashboard->'decision_card'->>'action'                    AS dashboard_value
  FROM reports r
  LEFT JOIN report_artifacts a ON a.report_id = r.id
 WHERE r.deleted_at IS NULL;
"""

UPDATE_SQL = "UPDATE reports SET recommendation = %s WHERE id = %s::uuid;"


def normalize(raw: str | None) -> str | None:
    if raw is None:
        return None
    key = str(raw).strip().upper()
    if not key:
        return None
    # Order matters: check the more specific phrases first.
    # Legacy two-bucket LONG/SHORT maps to the strong tone for visual continuity.
    if "STRONG BUY" in key or key == "LONG":
        return "Strong Buy"
    if "STRONG SELL" in key or key == "SHORT":
        return "Strong Sell"
    if "HOLD" in key or "NEUTRAL" in key:
        return "Hold"
    if "BUY" in key:
        return "Buy"
    if "SELL" in key:
        return "Sell"
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-url", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        conn = get_conn(args.db_url)
    except DatabaseUrlMissing as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    counts = {label: 0 for label in ALLOWED}
    counts["unchanged"] = 0
    counts["unmappable"] = 0
    updates: list[tuple[str, str]] = []
    unmappable: list[tuple[str, str, str | None, str | None]] = []

    with conn, conn.cursor() as cur:
        cur.execute(SELECT_SQL)
        for row_id, ticker, column_value, dashboard_value in cur.fetchall():
            target = normalize(dashboard_value) or normalize(column_value)
            if target is None:
                counts["unmappable"] += 1
                unmappable.append((row_id, ticker, column_value, dashboard_value))
                continue
            counts[target] += 1
            if target == column_value:
                counts["unchanged"] += 1
                continue
            updates.append((target, row_id))

        print(f"Scanned {sum(counts[l] for l in ALLOWED) + counts['unmappable']} rows.")
        for label in ALLOWED:
            print(f"  {label:<11} target  : {counts[label]}")
        print(f"  unchanged           : {counts['unchanged']}")
        print(f"  needs update        : {len(updates)}")
        print(f"  unmappable (skip)   : {counts['unmappable']}")
        if unmappable:
            print("\nUnmappable rows (left untouched):")
            for row_id, ticker, column_value, dashboard_value in unmappable[:20]:
                print(f"  {ticker:<10} col={column_value!r:<14} dash={dashboard_value!r}")
            if len(unmappable) > 20:
                print(f"  ... and {len(unmappable) - 20} more")

        if args.dry_run:
            print("\n[dry-run] no writes.")
            return 0

        if not updates:
            print("\nNothing to update.")
            return 0

        cur.executemany(UPDATE_SQL, updates)
        print(f"\nUpdated {len(updates)} rows.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
