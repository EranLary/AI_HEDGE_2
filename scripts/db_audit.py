"""Read-only audit of the configured site Postgres database.

Reports migration state, source-vs-live table drift, report/artifact integrity,
and relation sizes. The audit never creates, updates, or deletes database data.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from ai_hedge.db.connection import DatabaseUrlMissing, get_conn  # noqa: E402
from ai_hedge.db.migrate import list_applied, list_pending  # noqa: E402


_CREATE_TABLE_RE = re.compile(
    r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    r"(?:(?:public\.)?\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?)",
    re.IGNORECASE,
)


def expected_tables_from_repo(root: Path = ROOT) -> set[str]:
    """Return table names declared by the core snapshot and SQL migrations."""
    sql_files = [root / "src" / "ai_hedge" / "db" / "schema.sql"]
    sql_files.extend(sorted((root / "src" / "ai_hedge" / "db" / "migrations").glob("*.sql")))
    expected = {"schema_migrations"}
    for path in sql_files:
        if not path.is_file():
            continue
        expected.update(match.group(1).lower() for match in _CREATE_TABLE_RE.finditer(path.read_text(encoding="utf-8")))
    return expected


def _fetch_dicts(conn, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        columns = [description.name for description in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def collect_audit(conn) -> dict[str, Any]:
    """Collect the complete audit payload inside a read-only transaction."""
    with conn.cursor() as cur:
        cur.execute("SET TRANSACTION READ ONLY;")

    actual_rows = _fetch_dicts(
        conn,
        """
        SELECT c.relname AS table_name,
               coalesce(s.n_live_tup, 0)::bigint AS approximate_rows,
               pg_total_relation_size(c.oid)::bigint AS total_bytes
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
         WHERE n.nspname = 'public' AND c.relkind = 'r'
         ORDER BY pg_total_relation_size(c.oid) DESC, c.relname;
        """,
    )
    actual = {str(row["table_name"]).lower() for row in actual_rows}
    expected = expected_tables_from_repo()

    payload: dict[str, Any] = {
        "migrations": {
            "applied": sorted(list_applied(conn)),
            "pending": list_pending(conn),
        },
        "tables": actual_rows,
        "missing_tables": sorted(expected - actual),
        "unexpected_tables": sorted(actual - expected),
        "report_integrity": None,
    }

    if {"reports", "report_artifacts"}.issubset(actual):
        payload["report_integrity"] = _fetch_dicts(
            conn,
            """
            SELECT count(*) FILTER (WHERE r.deleted_at IS NULL)::bigint AS active_reports,
                   count(*) FILTER (WHERE r.deleted_at IS NOT NULL)::bigint AS deleted_reports,
                   count(*) FILTER (WHERE a.report_id IS NULL)::bigint AS reports_without_artifact,
                   (SELECT count(*)::bigint
                      FROM report_artifacts orphan_a
                      LEFT JOIN reports orphan_r ON orphan_r.id = orphan_a.report_id
                     WHERE orphan_r.id IS NULL) AS orphan_artifacts,
                   count(*) FILTER (
                       WHERE a.r2_keys IS NOT NULL AND a.r2_keys <> '{}'::jsonb
                   )::bigint AS reports_with_r2
              FROM reports r
              LEFT JOIN report_artifacts a ON a.report_id = r.id;
            """,
        )[0]

    conn.rollback()
    return payload


def audit_failures(payload: dict[str, Any], *, fail_on_unexpected: bool = False) -> list[str]:
    failures: list[str] = []
    pending = payload["migrations"]["pending"]
    if pending:
        failures.append(f"{len(pending)} pending migration(s)")
    if payload["missing_tables"]:
        failures.append(f"{len(payload['missing_tables'])} source-defined table(s) missing")
    if fail_on_unexpected and payload["unexpected_tables"]:
        failures.append(f"{len(payload['unexpected_tables'])} unexpected table(s)")
    integrity = payload.get("report_integrity") or {}
    if int(integrity.get("reports_without_artifact") or 0):
        failures.append("reports without report_artifacts")
    if int(integrity.get("orphan_artifacts") or 0):
        failures.append("orphan report_artifacts")
    return failures


def _human_bytes(value: int) -> str:
    size = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:,.1f} {unit}"
        size /= 1024
    return f"{size:,.1f} TB"


def print_human(payload: dict[str, Any]) -> None:
    migrations = payload["migrations"]
    print(f"migrations: {len(migrations['applied'])} applied, {len(migrations['pending'])} pending")
    if migrations["pending"]:
        for name in migrations["pending"]:
            print(f"  pending: {name}")

    integrity = payload.get("report_integrity")
    if integrity:
        print(
            "reports: "
            f"{integrity['active_reports']} active, "
            f"{integrity['deleted_reports']} deleted, "
            f"{integrity['reports_without_artifact']} missing artifacts, "
            f"{integrity['orphan_artifacts']} orphan artifacts, "
            f"{integrity['reports_with_r2']} with R2 keys"
        )

    if payload["missing_tables"]:
        print("missing source-defined tables: " + ", ".join(payload["missing_tables"]))
    if payload["unexpected_tables"]:
        print("unexpected live tables: " + ", ".join(payload["unexpected_tables"]))

    total_bytes = sum(int(row["total_bytes"]) for row in payload["tables"])
    print(f"public schema size: {_human_bytes(total_bytes)} across {len(payload['tables'])} tables")
    print("largest tables:")
    for row in payload["tables"][:8]:
        print(
            f"  {row['table_name']:<36} "
            f"~{int(row['approximate_rows']):>8,} rows  {_human_bytes(int(row['total_bytes'])):>10}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-url", default=None)
    parser.add_argument("--json", action="store_true", help="Emit the full audit payload as JSON.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero for pending migrations, missing tables, or report/artifact integrity failures.",
    )
    parser.add_argument(
        "--fail-on-unexpected",
        action="store_true",
        help="Also fail when live tables are not declared by schema.sql or a migration.",
    )
    args = parser.parse_args()

    try:
        with get_conn(args.db_url) as conn:
            payload = collect_audit(conn)
    except DatabaseUrlMissing as exc:
        print(f"[db-audit] error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(payload, indent=2, default=str))
    else:
        print_human(payload)

    failures = audit_failures(payload, fail_on_unexpected=args.fail_on_unexpected)
    if failures:
        print("audit failures: " + "; ".join(failures), file=sys.stderr)
        return 1 if args.strict or args.fail_on_unexpected else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
