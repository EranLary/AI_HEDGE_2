from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _find_flyctl() -> str | None:
    found = shutil.which("flyctl")
    if found:
        return found
    candidates = []
    home = os.environ.get("USERPROFILE") or os.environ.get("HOME")
    if home:
        candidates.append(Path(home) / ".fly" / "bin" / "flyctl.exe")
        candidates.append(Path(home) / ".fly" / "bin" / "flyctl")
    for c in candidates:
        if c.exists():
            return str(c)
    return None

from ai_hedge.db.connection import DatabaseUrlMissing, get_conn
from ai_hedge.db.repository import (
    apply_schema,
    count_reports,
    get_latest_by_ticker,
    insert_report,
    md_source_distribution,
    total_size_bytes,
    upsert_ticker,
)
from ai_hedge.db.transform import iter_ticker_dirs, ticker_dir_to_row

DEFAULT_SOURCE = Path("./fly_snapshot/outputs")
DEFAULT_PULL_OUT = Path("./pulled")
DEFAULT_FLY_APP = "hedge-in-a-box-site"
DEFAULT_FLY_REMOTE_PATH = "/data/outputs"
DEFAULT_SNAPSHOT_DIR = Path("./fly_snapshot")


def _human_bytes(n: int | float) -> str:
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:,.1f} {unit}"
        n /= 1024
    return f"{n:,.1f} TB"


def cmd_init(args: argparse.Namespace) -> int:
    if args.reset and not args.yes:
        confirm = input(
            "About to DROP tickers, reports, report_artifacts. "
            "Type 'yes' to confirm: "
        )
        if confirm.strip().lower() != "yes":
            print("Aborted.")
            return 1
    with get_conn(args.db_url) as conn:
        apply_schema(conn, reset=args.reset)
    print(
        f"Schema {'reset and ' if args.reset else ''}applied "
        f"(tickers + reports + report_artifacts)."
    )
    return 0


def cmd_fly_fetch(args: argparse.Namespace) -> int:
    flyctl = _find_flyctl()
    if flyctl is None:
        print(
            "flyctl not found on PATH or in ~/.fly/bin. "
            "Install Fly CLI first.",
            file=sys.stderr,
        )
        return 2

    snapshot_dir: Path = args.snapshot_dir
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    archive_path = snapshot_dir / "outputs.tar.gz"
    extract_root = snapshot_dir / "outputs"

    remote_parent = str(Path(args.remote_path).parent).replace("\\", "/")
    remote_leaf = Path(args.remote_path).name
    fly_cmd = f"tar -czf - -C {remote_parent} {remote_leaf}"
    cmd = [
        flyctl, "ssh", "console",
        "--pty=false",
        "-a", args.app,
        "-C", f"sh -c \"{fly_cmd}\"",
    ]
    print(f"Streaming {args.app}:{args.remote_path} -> {archive_path}")
    if args.dry_run:
        print(f"[dry-run] would run: {' '.join(cmd)}")
        return 0

    with archive_path.open("wb") as out:
        proc = subprocess.run(cmd, stdout=out, stdin=subprocess.DEVNULL)
    if proc.returncode != 0:
        print(f"flyctl exited {proc.returncode}", file=sys.stderr)
        return proc.returncode

    if extract_root.exists():
        shutil.rmtree(extract_root)
    extract_root.mkdir(parents=True, exist_ok=True)

    print(f"Extracting -> {extract_root}")
    proc = subprocess.run(
        ["tar", "-xzf", str(archive_path), "-C", str(extract_root),
         "--strip-components=1"]
    )
    if proc.returncode != 0:
        print(f"tar extraction failed (exit {proc.returncode})", file=sys.stderr)
        return proc.returncode

    print(f"Snapshot ready at {extract_root}")
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    source: Path = args.source
    if not source.exists():
        print(f"Source not found: {source}", file=sys.stderr)
        return 2

    total = 0
    skipped = 0
    for ticker_dir in iter_ticker_dirs(source):
        bundle = ticker_dir_to_row(ticker_dir, source=args.tag)
        if bundle is None:
            skipped += 1
            print(f"  SKIP  {ticker_dir} (missing dashboard or analysis)")
            continue
        total += 1
        report_row = bundle["report_row"]
        artifact_row = bundle["artifact_row"]
        approx = (
            len(artifact_row["analysis_md"])
            + len(artifact_row["prices_explain_md"] or "")
            + len(json.dumps(artifact_row["dashboard"]))
        )
        print(
            f"  OK    {report_row['ticker']:<8} "
            f"{report_row['generated_at'].isoformat()}  "
            f"src={artifact_row['analysis_md_source']:<4} "
            f"~{_human_bytes(approx):>10}  {ticker_dir}"
        )
    print(f"\nFound {total} ticker dirs ({skipped} skipped).")
    return 0


def cmd_push(args: argparse.Namespace) -> int:
    source: Path = args.source
    if not source.exists():
        print(f"Source not found: {source}", file=sys.stderr)
        return 2

    inserted = 0
    skipped_dup = 0
    skipped_invalid = 0

    if args.dry_run:
        for ticker_dir in iter_ticker_dirs(source):
            bundle = ticker_dir_to_row(
                ticker_dir,
                source=args.tag,
                source_root=source,
                origin_root=args.origin_root,
            )
            if bundle is None:
                skipped_invalid += 1
                continue
            inserted += 1
        print(f"[dry-run] would insert ~{inserted}, skip {skipped_invalid} invalid")
        return 0

    with get_conn(args.db_url) as conn:
        for ticker_dir in iter_ticker_dirs(source):
            bundle = ticker_dir_to_row(
                ticker_dir,
                source=args.tag,
                source_root=source,
                origin_root=args.origin_root,
            )
            if bundle is None:
                skipped_invalid += 1
                print(f"  SKIP  {ticker_dir} (invalid)")
                continue

            try:
                upsert_ticker(conn, bundle["ticker_row"])
                report_id, was_inserted = insert_report(
                    conn, bundle["report_row"], bundle["artifact_row"]
                )
                conn.commit()
            except Exception as exc:
                conn.rollback()
                skipped_invalid += 1
                print(
                    f"  ERR   {bundle['report_row']['ticker']:<8} {ticker_dir} "
                    f"-> {type(exc).__name__}: {exc}"
                )
                continue

            ticker = bundle["report_row"]["ticker"]
            gen = bundle["report_row"]["generated_at"].isoformat()
            md_src = bundle["artifact_row"]["analysis_md_source"]
            if was_inserted:
                inserted += 1
                print(
                    f"  +     {ticker:<8} {gen}  src={md_src:<4}  id={report_id}"
                )
            else:
                skipped_dup += 1
                print(
                    f"  =     {ticker:<8} {gen}  src={md_src:<4}  (duplicate)"
                )

    print(
        f"\nInserted {inserted}, skipped {skipped_dup} duplicates, "
        f"{skipped_invalid} invalid/errored."
    )
    return 0


def cmd_pull(args: argparse.Namespace) -> int:
    out_root: Path = args.out
    with get_conn(args.db_url) as conn:
        record = get_latest_by_ticker(conn, args.ticker)
    if record is None:
        print(f"No row found for ticker {args.ticker!r}.", file=sys.stderr)
        return 1

    target = out_root / args.ticker
    target.mkdir(parents=True, exist_ok=True)

    dashboard_path = target / f"{args.ticker}_dashboard.json"
    analysis_path = target / f"{args.ticker}_analysis.txt"

    dashboard_path.write_text(
        json.dumps(record["dashboard"], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    analysis_path.write_text(record["analysis_md"], encoding="utf-8")

    if record.get("prices_explain_md"):
        (target / f"{args.ticker}_prices_explain.txt").write_text(
            record["prices_explain_md"], encoding="utf-8"
        )

    print(
        f"Wrote source files to {target}/  "
        f"(analysis_md_source={record['analysis_md_source']})"
    )

    if args.regen_pdf:
        from ai_hedge.text_to_pdf_check import convert_text_to_pdf

        merged_md = record["analysis_md"]
        if record.get("prices_explain_md"):
            merged_md = merged_md + "\n\n---\n\n" + record["prices_explain_md"]
        merged_path = target / f"{args.ticker}_analysis_pdf_source.txt"
        merged_path.write_text(merged_md, encoding="utf-8")

        pdf_path = target / f"{args.ticker}_analysis.pdf"
        convert_text_to_pdf(merged_path, pdf_path)
        print(f"Regenerated PDF: {pdf_path}")

    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    with get_conn(args.db_url) as conn:
        counts = count_reports(conn)
        sizes = total_size_bytes(conn)
        md_dist = md_source_distribution(conn)

    print(f"tickers          : {counts['tickers']}")
    print(f"reports (active) : {counts['reports']}")
    print(f"artifacts        : {counts['artifacts']}")
    print()
    total = (
        sizes["tickers_bytes"] + sizes["reports_bytes"] + sizes["artifacts_bytes"]
    )
    print(f"total size       : {_human_bytes(total)}")
    print(f"  tickers        : {_human_bytes(sizes['tickers_bytes'])}")
    print(f"  reports        : {_human_bytes(sizes['reports_bytes'])}")
    print(f"  artifacts      : {_human_bytes(sizes['artifacts_bytes'])}")
    if counts["artifacts"] > 0:
        print()
        print(f"avg dashboard      : {_human_bytes(sizes['avg_dashboard'])}")
        print(f"avg analysis_md    : {_human_bytes(sizes['avg_analysis'])}")
        print(f"avg prices_explain : {_human_bytes(sizes['avg_prices_explain'])}")
    if md_dist:
        print()
        print("analysis_md_source distribution:")
        for src, n in md_dist:
            print(f"  {src:<5} {n}")
    free_tier_ceiling = 0.5 * 1024 * 1024 * 1024
    pct = (total / free_tier_ceiling) * 100
    print(f"\n~{pct:.2f}% of Neon free-tier 0.5 GB ceiling")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dbcli",
        description="Neon DB management for AI_HEDGE reports.",
    )
    parser.add_argument(
        "--db-url",
        default=None,
        help="Postgres connection string (else DATABASE_URL_UNPOOLED / DATABASE_URL)",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="Apply schema (idempotent).")
    p_init.add_argument("--reset", action="store_true",
                        help="DROP existing tables before recreating.")
    p_init.add_argument("--yes", action="store_true",
                        help="Skip confirmation prompt for --reset.")
    p_init.set_defaults(func=cmd_init)

    p_fetch = sub.add_parser(
        "fly-fetch",
        help="Tar /data/outputs from the Fly machine into ./fly_snapshot/.",
    )
    p_fetch.add_argument("--app", default=DEFAULT_FLY_APP)
    p_fetch.add_argument("--remote-path", default=DEFAULT_FLY_REMOTE_PATH)
    p_fetch.add_argument("--snapshot-dir", type=Path, default=DEFAULT_SNAPSHOT_DIR)
    p_fetch.add_argument("--dry-run", action="store_true")
    p_fetch.set_defaults(func=cmd_fly_fetch)

    p_scan = sub.add_parser(
        "scan", help="Walk a local outputs tree, list detected ticker dirs."
    )
    p_scan.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    p_scan.add_argument("--tag", default="cli")
    p_scan.set_defaults(func=cmd_scan)

    p_push = sub.add_parser(
        "push", help="Insert rows into Neon for every ticker dir under --source."
    )
    p_push.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    p_push.add_argument(
        "--tag", default="cli",
        help="source column value: cli | site | fly_backfill",
    )
    p_push.add_argument(
        "--origin-root", default=DEFAULT_FLY_REMOTE_PATH,
        help="Prefix used to compute origin_path (e.g. /data/outputs).",
    )
    p_push.add_argument("--dry-run", action="store_true")
    p_push.set_defaults(func=cmd_push)

    p_pull = sub.add_parser(
        "pull", help="Write the latest row for a ticker back to disk."
    )
    p_pull.add_argument("ticker")
    p_pull.add_argument("--out", type=Path, default=DEFAULT_PULL_OUT)
    p_pull.add_argument(
        "--regen-pdf", action="store_true",
        help="Also regenerate the merged analysis PDF from the markdown.",
    )
    p_pull.set_defaults(func=cmd_pull)

    p_stats = sub.add_parser("stats", help="Show row counts and storage usage.")
    p_stats.set_defaults(func=cmd_stats)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except DatabaseUrlMissing as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
