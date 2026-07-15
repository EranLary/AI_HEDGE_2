from __future__ import annotations

import argparse
import json
import math
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import requests


SLICKCHARTS_SP500_URL = "https://www.slickcharts.com/sp500"
WIKIPEDIA_SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
CACHE_VERSION = 1


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.current_cell: List[str] = []
        self.current_row: List[str] = []
        self.rows: List[List[str]] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, str | None]]) -> None:
        attr = {key.lower(): value or "" for key, value in attrs}
        if tag == "table" and ("table" in attr.get("class", "") or not self.in_table):
            self.in_table = True
        if not self.in_table:
            return
        if tag == "tr":
            self.in_row = True
            self.current_row = []
        elif self.in_row and tag in {"td", "th"}:
            self.in_cell = True
            self.current_cell = []

    def handle_endtag(self, tag: str) -> None:
        if not self.in_table:
            return
        if tag in {"td", "th"} and self.in_cell:
            text = _clean_text(" ".join(self.current_cell))
            self.current_row.append(text)
            self.current_cell = []
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            if self.current_row:
                self.rows.append(self.current_row)
            self.current_row = []
            self.in_row = False
        elif tag == "table":
            self.in_table = False

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.current_cell.append(data)


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", unescape(str(value or ""))).strip()


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return str(value)


def _display_ticker(value: str) -> str:
    return _clean_text(value).upper()


def _yahoo_ticker(value: str) -> str:
    return _display_ticker(value).replace(".", "-")


def _cache_path() -> Path:
    return Path(__file__).resolve().parents[1] / "outputs" / "_screeners" / "sp500_profiles.json"


def _seed_path() -> Path:
    return Path(__file__).resolve().parents[1] / "src" / "ai_hedge" / "static_data" / "sp500_slickcharts_seed.json"


def _load_cache(max_age_minutes: int) -> Dict[str, Any] | None:
    path = _cache_path()
    if max_age_minutes <= 0 or not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        generated_at = datetime.fromisoformat(str(payload.get("generated_at", "")).replace("Z", "+00:00"))
    except Exception:
        return None
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - generated_at > timedelta(minutes=max_age_minutes):
        return None
    if payload.get("cache_version") != CACHE_VERSION:
        return None
    rows = payload.get("rows")
    return payload if isinstance(rows, list) and rows else None


def _write_cache(payload: Dict[str, Any]) -> None:
    path = _cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False, indent=2), encoding="utf-8")


def _get_html(url: str) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.text


def _parse_slickcharts_rows(html: str) -> List[Dict[str, Any]]:
    parser = _TableParser()
    parser.feed(html)
    rows: List[Dict[str, Any]] = []
    for raw in parser.rows:
        if len(raw) < 3:
            continue
        first = _clean_text(raw[0])
        if not first.isdigit():
            continue
        company = _clean_text(raw[1])
        ticker = _display_ticker(raw[2])
        if company and ticker:
            rows.append(
                {
                    "rank": int(first),
                    "ticker": ticker,
                    "query_ticker": _yahoo_ticker(ticker),
                    "company_name": company,
                }
            )
    return rows


def _parse_wikipedia_rows(html: str) -> List[Dict[str, Any]]:
    parser = _TableParser()
    parser.feed(html)
    rows: List[Dict[str, Any]] = []
    header_seen = False
    for raw in parser.rows:
        clean = [_clean_text(cell) for cell in raw]
        if not clean:
            continue
        if clean[0].lower() == "symbol":
            header_seen = True
            continue
        if not header_seen or len(clean) < 2:
            continue
        ticker = _display_ticker(clean[0])
        company = _clean_text(clean[1])
        if ticker and company and re.match(r"^[A-Z0-9.\-]+$", ticker):
            rows.append(
                {
                    "rank": len(rows) + 1,
                    "ticker": ticker,
                    "query_ticker": _yahoo_ticker(ticker),
                    "company_name": company,
                }
            )
    return rows


def _load_slickcharts_seed() -> List[Dict[str, Any]]:
    try:
        payload = json.loads(_seed_path().read_text(encoding="utf-8"))
    except Exception:
        return []
    rows: List[Dict[str, Any]] = []
    for idx, raw in enumerate(payload.get("rows") or [], start=1):
        if not isinstance(raw, dict):
            continue
        ticker = _display_ticker(str(raw.get("ticker") or ""))
        company = _clean_text(raw.get("company_name"))
        if not ticker or not company:
            continue
        rows.append(
            {
                "rank": int(raw.get("rank") or idx),
                "ticker": ticker,
                "query_ticker": _yahoo_ticker(str(raw.get("query_ticker") or ticker)),
                "company_name": company,
            }
        )
    return rows


def _fetch_universe() -> Tuple[List[Dict[str, Any]], str, str]:
    try:
        rows = _parse_slickcharts_rows(_get_html(SLICKCHARTS_SP500_URL))
        if rows:
            return rows, "slickcharts", SLICKCHARTS_SP500_URL
    except Exception:
        pass

    seed_rows = _load_slickcharts_seed()
    if seed_rows:
        return seed_rows, "slickcharts-seed", SLICKCHARTS_SP500_URL

    rows = _parse_wikipedia_rows(_get_html(WIKIPEDIA_SP500_URL))
    if not rows:
        raise RuntimeError("No S&P 500 holdings were found.")
    return rows, "wikipedia-fallback", WIKIPEDIA_SP500_URL


def _chunks(values: List[str], size: int) -> Iterable[List[str]]:
    for idx in range(0, len(values), size):
        yield values[idx : idx + size]


def _fetch_asset_profiles(symbols: List[str], workers: int) -> Dict[str, Dict[str, Any]]:
    try:
        from yahooquery import Ticker
    except Exception as exc:
        raise RuntimeError(f"yahooquery import failed: {type(exc).__name__}: {str(exc)[:240]}") from exc

    profiles: Dict[str, Dict[str, Any]] = {}

    def fetch_chunk(chunk: List[str]) -> Dict[str, Dict[str, Any]]:
        payload = Ticker(chunk).asset_profile
        if not isinstance(payload, dict):
            return {}
        clean: Dict[str, Dict[str, Any]] = {}
        for symbol in chunk:
            item = payload.get(symbol)
            clean[symbol] = _json_safe(item) if isinstance(item, dict) else {}
        return clean

    chunked = list(_chunks(symbols, 50))
    with ThreadPoolExecutor(max_workers=max(1, min(int(workers or 1), 8))) as pool:
        futures = {pool.submit(fetch_chunk, chunk): chunk for chunk in chunked}
        for future in as_completed(futures):
            try:
                profiles.update(future.result())
            except Exception:
                for symbol in futures[future]:
                    profiles.setdefault(symbol, {})
    return profiles


def build_payload(max_age_minutes: int, refresh: bool, workers: int) -> Dict[str, Any]:
    if not refresh:
        cached = _load_cache(max_age_minutes)
        if cached:
            cached = dict(cached)
            cached["cache_hit"] = True
            return cached

    universe, source, source_url = _fetch_universe()
    symbols = [str(row["query_ticker"]) for row in universe]
    profiles = _fetch_asset_profiles(symbols, workers)
    generated_at = datetime.now(timezone.utc).isoformat()
    rows: List[Dict[str, Any]] = []
    missing_profiles = 0

    for row in universe:
        query_ticker = str(row["query_ticker"])
        profile = profiles.get(query_ticker) or {}
        sector = _clean_text(profile.get("sector"))
        industry = _clean_text(profile.get("industry"))
        if not sector and not industry:
            missing_profiles += 1
        rows.append(
            {
                "rank": row["rank"],
                "ticker": row["ticker"],
                "query_ticker": query_ticker,
                "company_name": row["company_name"],
                "sector": sector or "Unknown",
                "industry": industry or "Unknown",
            }
        )

    payload = {
        "status": "success",
        "cache_version": CACHE_VERSION,
        "cache_hit": False,
        "generated_at": generated_at,
        "universe": "sp500",
        "universe_label": "S&P 500",
        "source": source,
        "source_url": source_url,
        "count": len(rows),
        "missing_profiles": missing_profiles,
        "rows": rows,
    }
    _write_cache(payload)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the S&P 500 screener profile table.")
    parser.add_argument("--cache-minutes", type=int, default=720)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    try:
        payload = build_payload(
            max_age_minutes=int(args.cache_minutes or 0),
            refresh=bool(args.refresh),
            workers=int(args.workers or 1),
        )
    except Exception as exc:
        payload = {
            "status": "error",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "universe": "sp500",
            "universe_label": "S&P 500",
            "rows": [],
            "error": f"{type(exc).__name__}: {str(exc)[:320]}",
        }
        print(json.dumps(payload, ensure_ascii=False, allow_nan=False))
        return 1

    print(json.dumps(payload, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
