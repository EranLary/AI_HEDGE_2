"""
Apply any pending SQL migrations under src/ai_hedge/db/migrations/.

Run:
    python scripts/migrate.py            # apply pending
    python scripts/migrate.py --dry-run  # show what would run, no changes

Wired into prod via fly.site.toml's [deploy] release_command, so every
site deploy reconciles the schema before traffic is shifted to the new
image. Safe to re-run; tracks applied filenames in schema_migrations.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

try:
    from dotenv import load_dotenv  # type: ignore[import-not-found]

    load_dotenv(ROOT / ".env")
except ImportError:
    # Production runs without python-dotenv; secrets come from the env directly.
    pass

from ai_hedge.db.connection import DatabaseUrlMissing, get_conn  # noqa: E402
from ai_hedge.db.migrate import (  # noqa: E402
    apply_pending_migrations,
    list_applied,
    list_pending,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-url", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        conn = get_conn(args.db_url)
    except DatabaseUrlMissing as exc:
        print(f"[migrate] error: {exc}", file=sys.stderr)
        return 2

    try:
        if args.dry_run:
            pending = list_pending(conn)
            applied = list_applied(conn)
            if not pending:
                print(f"[migrate] up to date ({len(applied)} applied, 0 pending)")
            else:
                print(
                    f"[migrate] would apply {len(pending)} migration(s) "
                    f"({len(applied)} already applied):"
                )
                for name in pending:
                    print(f"  - {name}")
            return 0

        newly = apply_pending_migrations(conn)
        if not newly:
            applied = list_applied(conn)
            print(f"[migrate] up to date ({len(applied)} applied)")
        else:
            for name in newly:
                print(f"[migrate] applied {name}")
            print(f"[migrate] applied {len(newly)} new migration(s)")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
