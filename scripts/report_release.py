"""Create, list, and atomically activate report releases.

This intentionally does not enumerate constituents or run analyses. It is the
minimal operator seam used to stage individually generated Nasdaq-100 reports.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from ai_hedge.db.connection import get_conn  # noqa: E402


def _find_release(cur, identifier: str):
    cur.execute(
        """
        SELECT id::text, workspace, release_key, status, created_at, activated_at
          FROM report_releases
         WHERE id::text = %s OR (workspace = 'nasdaq100' AND release_key = %s)
         LIMIT 1
         FOR UPDATE;
        """,
        (identifier, identifier),
    )
    return cur.fetchone()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create")
    create.add_argument("--key", required=True)
    activate = sub.add_parser("activate")
    activate.add_argument("--release", required=True, help="Release UUID or release key")
    sub.add_parser("list")
    args = parser.parse_args()

    with get_conn() as conn:
        with conn.cursor() as cur:
            if args.command == "create":
                cur.execute(
                    """
                    INSERT INTO report_releases (workspace, release_key)
                    VALUES ('nasdaq100', %s)
                    ON CONFLICT (workspace, release_key) DO UPDATE
                       SET release_key = EXCLUDED.release_key
                    RETURNING id::text, workspace, release_key, status, created_at, activated_at;
                    """,
                    (args.key.strip(),),
                )
                rows = [cur.fetchone()]
            elif args.command == "activate":
                release = _find_release(cur, args.release.strip())
                if not release:
                    raise ValueError("Release was not found.")
                cur.execute("SELECT count(*) FROM reports WHERE release_id = %s::uuid;", (release[0],))
                if int(cur.fetchone()[0]) < 1:
                    raise ValueError("Cannot activate an empty release.")
                cur.execute(
                    """
                    UPDATE report_releases
                       SET status = 'active', activated_at = now()
                     WHERE id = %s::uuid AND workspace = 'nasdaq100' AND status = 'staged'
                    RETURNING id::text, workspace, release_key, status, created_at, activated_at;
                    """,
                    (release[0],),
                )
                updated = cur.fetchone()
                if not updated:
                    raise ValueError("Release is already active.")
                cur.execute(
                    "UPDATE reports SET available_at = %s WHERE release_id = %s::uuid;",
                    (updated[5], release[0]),
                )
                rows = [updated]
            else:
                cur.execute(
                    """
                    SELECT id::text, workspace, release_key, status, created_at, activated_at
                      FROM report_releases
                     ORDER BY created_at DESC;
                    """
                )
                rows = cur.fetchall()
        conn.commit()

    payload = [
        {
            "id": str(row[0]),
            "workspace": str(row[1]),
            "release_key": str(row[2]),
            "status": str(row[3]),
            "created_at": row[4].isoformat(),
            "activated_at": row[5].isoformat() if row[5] else None,
        }
        for row in rows
        if row
    ]
    print(json.dumps(payload[0] if len(payload) == 1 else payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
