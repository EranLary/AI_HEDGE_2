from __future__ import annotations

from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).with_name("migrations")

_CREATE_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
"""


def _list_files(migrations_dir: Path) -> list[Path]:
    return sorted(p for p in migrations_dir.glob("*.sql") if p.is_file())


def list_applied(conn: psycopg.Connection) -> set[str]:
    """Return the set of migration filenames already recorded in schema_migrations.

    Returns an empty set if the tracking table does not exist yet.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT to_regclass('public.schema_migrations') IS NOT NULL;"
        )
        row = cur.fetchone()
    if not row or not row[0]:
        return set()
    with conn.cursor() as cur:
        cur.execute("SELECT filename FROM schema_migrations;")
        return {r[0] for r in cur.fetchall()}


def list_pending(
    conn: psycopg.Connection,
    *,
    migrations_dir: Path = MIGRATIONS_DIR,
) -> list[str]:
    """Filenames present on disk but not yet recorded in schema_migrations."""
    applied = list_applied(conn)
    return [p.name for p in _list_files(migrations_dir) if p.name not in applied]


def apply_pending_migrations(
    conn: psycopg.Connection,
    *,
    migrations_dir: Path = MIGRATIONS_DIR,
) -> list[str]:
    """Apply every migration not yet recorded, in lexical order.

    Each migration runs together with its tracking-row insert in a single
    transaction. A failed migration leaves schema_migrations untouched, so the
    next run retries the same file. The tracking table itself is created on
    first call.

    Returns the list of newly-applied filenames (empty if up to date).
    """
    with conn.cursor() as cur:
        cur.execute(_CREATE_TRACKING_TABLE)
    conn.commit()

    applied = list_applied(conn)
    newly_applied: list[str] = []
    for path in _list_files(migrations_dir):
        if path.name in applied:
            continue
        sql = path.read_text(encoding="utf-8")
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (filename) VALUES (%s);",
                    (path.name,),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        newly_applied.append(path.name)
    return newly_applied
