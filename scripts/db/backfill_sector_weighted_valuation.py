"""Backfill sector-weighted-v1 into active Analysis and Nasdaq reports.

Dry-run is the default. Pass ``--apply`` to atomically update each batch's
dashboard JSON and the matching reports summary columns. Valuation prose,
generated_at, release/workspace fields, R2 pointers, and portfolio history are
never changed.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from ai_hedge.db.connection import DatabaseUrlMissing, get_conn  # noqa: E402
from ai_hedge.db.transform import _pluck_dashboard_fields  # noqa: E402
from ai_hedge.sector_weighted_valuation import POLICY_VERSION, apply_to_dashboard, canonical_sector  # noqa: E402


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-url", default=None)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Read and calculate only (default).")
    mode.add_argument("--apply", action="store_true", help="Persist dashboard and report-summary changes.")
    parser.add_argument("--workspace", choices=("all", "analysis", "nasdaq100"), default="all")
    parser.add_argument("--report-id", action="append", default=[])
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--force", action="store_true", help="Recompute reports already carrying this policy version.")
    return parser.parse_args()


def _load_rows(conn, args: argparse.Namespace) -> list[dict[str, Any]]:
    clauses = ["r.deleted_at IS NULL"]
    params: list[Any] = []
    if args.workspace != "all":
        clauses.append("r.workspace = %s")
        params.append(args.workspace)
    if args.report_id:
        clauses.append("r.id = ANY(%s::uuid[])")
        params.append(args.report_id)
    limit_sql = ""
    if args.limit:
        limit_sql = "LIMIT %s"
        params.append(args.limit)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT r.id::text AS report_id, r.ticker, r.workspace,
                   t.sector, t.profile_source
              FROM reports r
              JOIN report_artifacts a ON a.report_id = r.id
              LEFT JOIN tickers t ON t.symbol = r.ticker
             WHERE {' AND '.join(clauses)}
             ORDER BY r.workspace, r.generated_at, r.id
             {limit_sql}
            """,
            params,
        )
        columns = [column.name for column in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def _load_dashboards(conn, report_ids: list[str]) -> dict[str, dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT report_id::text, dashboard
              FROM report_artifacts
             WHERE report_id = ANY(%s::uuid[])
            """,
            (report_ids,),
        )
        return {
            str(report_id): dashboard
            for report_id, dashboard in cur.fetchall()
            if isinstance(dashboard, dict)
        }


def _already_current(dashboard: dict[str, Any]) -> bool:
    weighted = ((dashboard.get("valuation_hub") or {}).get("sector_weighted_valuation") or {})
    return weighted.get("policy_version") == POLICY_VERSION


def _persist_batch(conn, updates: list[tuple[dict[str, Any], str]]) -> None:
    with conn.cursor() as cur:
        for dashboard, report_id in updates:
            summary = _pluck_dashboard_fields(dashboard)
            cur.execute(
                """
                UPDATE report_artifacts
                   SET dashboard = %s::jsonb
                 WHERE report_id = %s::uuid
                """,
                (json.dumps(dashboard, ensure_ascii=False, allow_nan=False), report_id),
            )
            cur.execute(
                """
                UPDATE reports
                   SET mean_target_price = %s,
                       median_target_price = %s,
                       consensus_target_price = %s,
                       consensus_allocation_pct = %s,
                       consensus_score = %s,
                       consensus_basis = %s
                 WHERE id = %s::uuid;
                """,
                (
                    summary["mean_target_price"],
                    summary["median_target_price"],
                    summary["consensus_target_price"],
                    summary["consensus_allocation_pct"],
                    summary["consensus_score"],
                    summary["consensus_basis"],
                    report_id,
                ),
            )


def main() -> int:
    args = _parse_args()
    try:
        conn = get_conn(args.db_url)
    except DatabaseUrlMissing as exc:
        print(f"[sector-weighted-backfill] error: {exc}", file=sys.stderr)
        return 2

    counts: Counter[str] = Counter()
    by_sector: Counter[str] = Counter()
    missing_families: Counter[str] = Counter()
    pending: list[tuple[dict[str, Any], str]] = []
    applied_at = datetime.now(timezone.utc).isoformat()
    try:
        rows = _load_rows(conn, args)
        counts["selected"] = len(rows)
        batch_size = max(1, int(args.batch_size))
        for start in range(0, len(rows), batch_size):
            batch = rows[start : start + batch_size]
            dashboards = _load_dashboards(conn, [str(row["report_id"]) for row in batch])
            for row in batch:
                dashboard = dashboards.get(str(row["report_id"]), {})
                if _already_current(dashboard) and not args.force:
                    counts["already_current"] += 1
                    continue
                sector = canonical_sector(row.get("sector"))
                if not sector:
                    counts["missing_sector"] += 1
                    continue
                try:
                    updated = apply_to_dashboard(
                        dashboard,
                        sector=sector,
                        sector_source=str(row.get("profile_source") or "tickers"),
                        provenance="backfill",
                        computed_at=applied_at,
                    )
                    model = ((updated.get("valuation_hub") or {}).get("sector_weighted_valuation") or {})
                    if model.get("policy_version") != POLICY_VERSION:
                        counts["not_computable"] += 1
                        continue
                    # Dry-run validates the exact payload and summary projection
                    # that apply mode would persist, including non-finite guards.
                    json.dumps(updated, ensure_ascii=False, allow_nan=False)
                    summary = _pluck_dashboard_fields(updated)
                    counts[f"basis:{summary['consensus_basis'] or 'none'}"] += 1
                    by_sector[sector] += 1
                    for item in model.get("family_weights") or []:
                        if isinstance(item, dict) and item.get("status") == "missing":
                            missing_families[str(item.get("family") or "Unknown")] += 1
                    pending.append((updated, str(row["report_id"])))
                    counts[f"workspace:{row['workspace']}"] += 1
                    counts["changed"] += 1
                except Exception as exc:  # noqa: BLE001
                    counts["errors"] += 1
                    print(f"[sector-weighted-backfill] report {row['report_id']} failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            if args.apply and pending:
                _persist_batch(conn, pending)
                conn.commit()
                counts["applied"] += len(pending)
                pending.clear()

        if not args.apply:
            conn.rollback()

        mode = "APPLY" if args.apply else "DRY-RUN"
        print(f"[sector-weighted-backfill] {mode} policy={POLICY_VERSION}")
        print("[sector-weighted-backfill] counts " + json.dumps(dict(sorted(counts.items())), sort_keys=True))
        print("[sector-weighted-backfill] sectors " + json.dumps(dict(sorted(by_sector.items())), sort_keys=True))
        print("[sector-weighted-backfill] missing_families " + json.dumps(dict(sorted(missing_families.items())), sort_keys=True))
        return 1 if counts["errors"] or counts["missing_sector"] or counts["not_computable"] else 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
