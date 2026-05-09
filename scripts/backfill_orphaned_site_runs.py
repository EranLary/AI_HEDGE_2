"""
Backfill `reports` rows for site runs whose artifacts exist on the volume
but whose DB row was never inserted (e.g. due to schema drift or transient
DB failures).

For each `<jobId>/` dir under --root:
- Read `_status.json`.
- Skip unless `result.status` is "success" or "partial_success" — mirrors
  the success gate in scripts/site_run.py so we don't promote a genuinely
  failed run.
- Resolve the inner `<TICKER>/` dir.
- If a row already exists for source_run_id=<jobId>, skip (idempotent).
- Otherwise call write_run_to_db() and, on success, rewrite `_status.json`:
    status=completed, report_id=<id>, persistence_error="", and clear the
    legacy persistence-failure error string if present.

Run:
    python scripts/backfill_orphaned_site_runs.py
    python scripts/backfill_orphaned_site_runs.py --root /data/outputs/_site_runs
    python scripts/backfill_orphaned_site_runs.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

try:
    from dotenv import load_dotenv  # type: ignore[import-not-found]

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from ai_hedge.db.connection import DatabaseUrlMissing, resolve_db_url  # noqa: E402
from ai_hedge.db.writer import (  # noqa: E402
    find_report_id_by_source_run_id,
    write_run_to_db,
)


_LEGACY_PERSISTENCE_RE = "no reports row found for source_run_id"
_MATERIAL_SUCCESS = {"success", "partial_success"}


def _looks_like_material_success(result: object) -> bool:
    if not isinstance(result, dict):
        return False
    return str(result.get("status", "")).strip().lower() in _MATERIAL_SUCCESS


def _is_legacy_persistence_text(text: object) -> bool:
    return _LEGACY_PERSISTENCE_RE in str(text or "").lower()


def _rewrite_status_after_backfill(
    status_path: Path, status: dict, report_id: str
) -> None:
    next_status = dict(status)
    next_status["report_id"] = report_id
    next_status["persistence_error"] = ""
    if next_status.get("status") == "failed" and _is_legacy_persistence_text(
        status.get("persistence_error") or status.get("error")
    ):
        next_status["status"] = "completed"
    if _is_legacy_persistence_text(next_status.get("error")):
        next_status["error"] = ""
    status_path.write_text(
        json.dumps(next_status, indent=2), encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default="/data/outputs/_site_runs",
        help="Path to the _site_runs directory (default: /data/outputs/_site_runs).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report which runs would be backfilled without touching the DB or status files.",
    )
    args = parser.parse_args()

    try:
        resolve_db_url()
    except DatabaseUrlMissing as exc:
        print(f"[backfill] error: {exc}", file=sys.stderr)
        return 2

    root = Path(args.root)
    if not root.exists():
        print(f"[backfill] error: --root does not exist: {root}", file=sys.stderr)
        return 2

    counts = {
        "inserted": 0,
        "would_insert": 0,
        "already_present": 0,
        "skipped_no_status": 0,
        "skipped_unsuccessful": 0,
        "skipped_no_dir": 0,
        "failed": 0,
    }

    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        job_id = entry.name
        status_path = entry / "_status.json"
        if not status_path.exists():
            counts["skipped_no_status"] += 1
            continue
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            print(
                f"[backfill] {job_id}: cannot read status ({exc})",
                file=sys.stderr,
            )
            counts["failed"] += 1
            continue

        if not _looks_like_material_success(status.get("result")):
            counts["skipped_unsuccessful"] += 1
            continue

        ticker = str(status.get("ticker") or "").strip().upper()
        if not ticker:
            counts["skipped_no_dir"] += 1
            continue

        ticker_dir = entry / ticker
        if not ticker_dir.is_dir():
            print(
                f"[backfill] {job_id}: missing ticker dir {ticker_dir}",
                file=sys.stderr,
            )
            counts["skipped_no_dir"] += 1
            continue

        existing = find_report_id_by_source_run_id(
            source_run_id=job_id, source="site", ticker=ticker
        )
        if existing:
            counts["already_present"] += 1
            print(f"[backfill] {job_id} ({ticker}): already in db ({existing})")
            continue

        if args.dry_run:
            counts["would_insert"] += 1
            print(f"[backfill] {job_id} ({ticker}): would insert (dry-run)")
            continue

        report_id, write_err = write_run_to_db(
            ticker_dir,
            source="site",
            max_attempts=3,
            retry_backoff_seconds=1.5,
        )
        if not report_id:
            # write_run_to_db returns None on dedup races too; double-check.
            report_id = find_report_id_by_source_run_id(
                source_run_id=job_id, source="site", ticker=ticker
            )
        if not report_id:
            counts["failed"] += 1
            err = write_err or "no row returned"
            print(
                f"[backfill] {job_id} ({ticker}): write failed ({err})",
                file=sys.stderr,
            )
            continue

        try:
            _rewrite_status_after_backfill(status_path, status, report_id)
        except OSError as exc:
            # DB row landed; status rewrite is the cosmetic half. Don't fail the run.
            print(
                f"[backfill] {job_id} ({ticker}): inserted {report_id}, "
                f"but status rewrite failed: {exc}",
                file=sys.stderr,
            )
        counts["inserted"] += 1
        print(f"[backfill] {job_id} ({ticker}): inserted {report_id}")

    total = sum(counts.values())
    print()
    print(f"[backfill] processed {total} dirs:")
    for key, value in counts.items():
        print(f"  {key}: {value}")
    return 0 if counts["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
