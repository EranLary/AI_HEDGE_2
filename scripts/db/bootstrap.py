"""Initialize an empty site database, then apply all pending migrations.

This command is for a new or disposable database. Existing complete databases
skip the schema snapshot and receive pending migrations only. A partially
initialized core schema is refused instead of being guessed or repaired.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from ai_hedge.db.connection import DatabaseUrlMissing, get_conn  # noqa: E402
from ai_hedge.db.migrate import apply_pending_migrations, list_pending  # noqa: E402
from ai_hedge.db.repository import apply_schema  # noqa: E402


CORE_TABLES = frozenset({"users", "tickers", "report_releases", "reports", "report_artifacts"})
INITIALIZATION_MARKERS = CORE_TABLES | frozenset(
    {
        "schema_migrations",
        "site_runs",
        "nasdaq_universe_runs",
        "portfolio_snapshots",
        "trading_connections",
        "obs_runs",
    }
)


def classify_core_state(existing_tables: set[str]) -> str:
    present = CORE_TABLES.intersection(existing_tables)
    if not present:
        return "partial" if INITIALIZATION_MARKERS.intersection(existing_tables) else "empty"
    if present == CORE_TABLES:
        return "complete"
    return "partial"


def _public_tables(conn) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT tablename
              FROM pg_catalog.pg_tables
             WHERE schemaname = 'public';
            """
        )
        return {str(row[0]).lower() for row in cur.fetchall()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-url", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        conn = get_conn(args.db_url)
    except DatabaseUrlMissing as exc:
        print(f"[bootstrap-db] error: {exc}", file=sys.stderr)
        return 2

    try:
        state = classify_core_state(_public_tables(conn))
        if state == "partial":
            print(
                "[bootstrap-db] refusing partially initialized core schema; "
                "inspect it with scripts/db/audit.py before making changes.",
                file=sys.stderr,
            )
            return 1

        pending = list_pending(conn)
        if args.dry_run:
            print(f"[bootstrap-db] core schema: {state}")
            if state == "empty":
                print("[bootstrap-db] would apply src/ai_hedge/db/schema.sql")
            print(f"[bootstrap-db] would apply {len(pending)} pending migration(s)")
            for name in pending:
                print(f"  - {name}")
            return 0

        if state == "empty":
            apply_schema(conn)
            print("[bootstrap-db] applied core schema snapshot")
        else:
            print("[bootstrap-db] core schema already present")

        newly_applied = apply_pending_migrations(conn)
        for name in newly_applied:
            print(f"[bootstrap-db] applied {name}")
        print(f"[bootstrap-db] ready ({len(newly_applied)} new migration(s))")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
