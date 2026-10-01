"""Backfill persisted sector and industry for every ticker with an active report.

The script is safe to resume: by default it fetches only tickers missing either
classification field and never replaces a saved value with an empty provider
response. Use ``--refresh-all`` only for an intentional full refresh.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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

from ai_hedge.company_profile import resolve_company_profile  # noqa: E402
from ai_hedge.db.connection import DatabaseUrlMissing, get_conn  # noqa: E402
from ai_hedge.db.repository import upsert_ticker  # noqa: E402


def _yahooquery_symbol(symbol: str) -> str:
    clean = str(symbol or "").strip().upper()
    if re.fullmatch(r"[A-Z0-9-]+\.[A-Z]", clean):
        return clean.replace(".", "-")
    return clean


def _yahooquery_profile(symbol: str) -> dict[str, str]:
    from yahooquery import Ticker

    query_symbol = _yahooquery_symbol(symbol)
    payload = Ticker(query_symbol, timeout=20).asset_profile
    if not isinstance(payload, dict):
        return {}
    candidate = payload.get(query_symbol) or payload.get(symbol) or payload
    if not isinstance(candidate, dict):
        return {}
    return {
        "sector": str(candidate.get("sector") or "").strip(),
        "industry": str(candidate.get("industry") or "").strip(),
    }


def fetch_profile(symbol: str, *, attempts: int = 2) -> dict[str, str]:
    """Fetch the analysis-authoritative profile with a YahooQuery fallback."""

    import yfinance as yf

    raw_info: dict[str, Any] = {}
    last_error = ""
    for attempt in range(1, max(1, attempts) + 1):
        try:
            candidate = yf.Ticker(symbol).info
            if isinstance(candidate, dict):
                raw_info = candidate
                break
            last_error = f"yfinance returned {type(candidate).__name__}"
        except Exception as exc:  # noqa: BLE001
            last_error = f"{type(exc).__name__}: {str(exc)[:240]}"
        if attempt < attempts:
            time.sleep(float(attempt))

    base = resolve_company_profile({"info": raw_info})
    if base.get("sector") and base.get("industry"):
        return base

    try:
        fallback = _yahooquery_profile(symbol)
    except Exception as exc:  # noqa: BLE001
        if not last_error:
            last_error = f"{type(exc).__name__}: {str(exc)[:240]}"
        fallback = {}
    resolved = resolve_company_profile(
        {
            "info": raw_info,
            "yahooquery": {"company_profile": fallback},
        }
    )
    if not resolved.get("sector") and not resolved.get("industry"):
        resolved["error"] = last_error or "Yahoo returned no classification."
    return resolved


def _load_tickers(conn, *, refresh_all: bool, limit: int | None) -> list[dict[str, Any]]:
    where_profile = "" if refresh_all else "AND (t.sector IS NULL OR btrim(t.sector) = '' OR t.industry IS NULL OR btrim(t.industry) = '')"
    limit_sql = "" if not limit else "LIMIT %s"
    params: tuple[Any, ...] = () if not limit else (limit,)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT t.symbol, t.sector, t.industry,
                   array_agg(DISTINCT r.workspace ORDER BY r.workspace) AS workspaces
              FROM tickers t
              JOIN reports r ON r.ticker = t.symbol
             WHERE r.deleted_at IS NULL
               AND r.workspace IN ('analysis', 'nasdaq100')
               {where_profile}
             GROUP BY t.symbol, t.sector, t.industry
             ORDER BY t.symbol
             {limit_sql};
            """,
            params,
        )
        columns = [column.name for column in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-url", default=None)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--refresh-all", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        conn = get_conn(args.db_url)
    except DatabaseUrlMissing as exc:
        print(f"[ticker-profile-backfill] error: {exc}", file=sys.stderr)
        return 2

    try:
        try:
            rows = _load_tickers(conn, refresh_all=args.refresh_all, limit=args.limit)
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            print(
                "[ticker-profile-backfill] failed to read ticker profile columns; "
                "apply migration 019_ticker_company_profiles.sql first: "
                f"{type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
            return 2

        print(f"[ticker-profile-backfill] selected {len(rows)} ticker(s)")
        if not rows:
            return 0

        fetched: dict[str, dict[str, str]] = {}
        worker_count = max(1, min(int(args.workers), 16))
        with ThreadPoolExecutor(max_workers=worker_count) as pool:
            futures = {pool.submit(fetch_profile, str(row["symbol"])): str(row["symbol"]) for row in rows}
            for index, future in enumerate(as_completed(futures), start=1):
                symbol = futures[future]
                try:
                    fetched[symbol] = future.result()
                except Exception as exc:  # noqa: BLE001
                    fetched[symbol] = {"sector": "", "industry": "", "source": "", "error": str(exc)[:240]}
                if index % 25 == 0 or index == len(futures):
                    print(f"[ticker-profile-backfill] fetched {index}/{len(futures)}")

        updated = 0
        unresolved: list[str] = []
        updated_by_workspace = {"analysis": 0, "nasdaq100": 0}
        now = datetime.now(timezone.utc)
        for row in rows:
            symbol = str(row["symbol"])
            profile = fetched.get(symbol) or {}
            sector = str(profile.get("sector") or "").strip()
            industry = str(profile.get("industry") or "").strip()
            if not sector and not industry:
                unresolved.append(symbol)
                continue
            updated += 1
            for workspace in row.get("workspaces") or []:
                if workspace in updated_by_workspace:
                    updated_by_workspace[workspace] += 1
            if not args.dry_run:
                upsert_ticker(
                    conn,
                    {
                        "symbol": symbol,
                        "sector": sector or None,
                        "industry": industry or None,
                        "profile_source": str(profile.get("source") or "").strip() or None,
                        "profile_updated_at": now,
                    },
                )

        if args.dry_run:
            conn.rollback()
        else:
            conn.commit()

        mode = "would update" if args.dry_run else "updated"
        print(
            f"[ticker-profile-backfill] {mode} {updated}/{len(rows)} ticker(s); "
            f"analysis={updated_by_workspace['analysis']}, "
            f"nasdaq100={updated_by_workspace['nasdaq100']}"
        )
        if unresolved:
            print(
                f"[ticker-profile-backfill] unresolved {len(unresolved)} ticker(s): "
                + ", ".join(unresolved),
                file=sys.stderr,
            )
            return 1
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
