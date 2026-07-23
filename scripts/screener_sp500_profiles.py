from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import requests
import pandas as pd


SLICKCHARTS_SP500_URL = "https://www.slickcharts.com/sp500"
SLICKCHARTS_NASDAQ100_URL = "https://www.slickcharts.com/nasdaq100"
TRADINGVIEW_TA125_URL = "https://il.tradingview.com/symbols/TASE-TA125/components/"
TRADINGVIEW_ISRAEL_SCAN_URL = "https://scanner.tradingview.com/israel/scan"
WIKIPEDIA_SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
CACHE_VERSION = 5
UNIVERSE_CONFIGS = {
    "sp500": {
        "label": "S&P 500",
        "source_url": SLICKCHARTS_SP500_URL,
        "seed_file": "sp500_slickcharts_seed.json",
        "cache_file": "sp500_profiles.json",
        "scored_seed_file": "sp500_screener_scores_seed.json",
    },
    "nasdaq100": {
        "label": "NASDAQ 100",
        "source_url": SLICKCHARTS_NASDAQ100_URL,
        "seed_file": "nasdaq100_slickcharts_seed.json",
        "cache_file": "nasdaq100_profiles.json",
        "scored_seed_file": "nasdaq100_screener_scores_seed.json",
    },
    "ta125": {
        "label": "TA-125",
        "source_url": TRADINGVIEW_TA125_URL,
        "seed_file": "ta125_tradingview_seed.json",
        "cache_file": "ta125_profiles.json",
        "scored_seed_file": "ta125_screener_scores_seed.json",
    },
}
VALUATION_METRIC_KEYS = ("peRatio", "pbRatio", "evToEbitda", "evToRevenue", "evToFcf")
MARGIN_METRIC_KEYS = ("grossMargin", "ebitdaMargin", "operatingMargin", "netProfitMargin", "fcfMargin")
QUALITY_METRIC_KEYS = (
    *MARGIN_METRIC_KEYS,
    "revenueGrowth",
    "earningsGrowth",
    "roa",
    "roe",
    "debtToEquity",
)
VALUATION_CONFIGS = {metric: {"direction": "lower", "weight": 0.20} for metric in VALUATION_METRIC_KEYS}
QUALITY_CONFIGS = {
    "fcfMargin": {"direction": "higher", "weight": 0.10},
    "operatingMargin": {"direction": "higher", "weight": 0.10},
    "netProfitMargin": {"direction": "higher", "weight": 0.10},
    "grossMargin": {"direction": "higher", "weight": 0.10},
    "ebitdaMargin": {"direction": "higher", "weight": 0.10},
    "revenueGrowth": {"direction": "higher", "weight": 0.10, "clamp": {"min": -0.5, "max": 1}},
    "earningsGrowth": {"direction": "higher", "weight": 0.10, "clamp": {"min": -0.5, "max": 1}},
    "roa": {"direction": "higher", "weight": 0.10, "clamp": {"min": -0.3, "max": 0.5}},
    "roe": {"direction": "higher", "weight": 0.10, "clamp": {"min": -0.3, "max": 0.5}},
    "debtToEquity": {"direction": "lower", "weight": 0.10},
}
SMALL_INDUSTRY_MAX_COUNT = 4
MEDIUM_INDUSTRY_MAX_COUNT = 15


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
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    return str(value)


def _first_number(*values: Any) -> float | None:
    for value in values:
        if isinstance(value, bool):
            continue
        try:
            num = float(value)
        except Exception:
            continue
        if math.isfinite(num):
            return num
    return None


def _positive_number(*values: Any) -> float | None:
    value = _first_number(*values)
    return value if value is not None and value > 0 else None


def _non_negative_number(*values: Any) -> float | None:
    value = _first_number(*values)
    return value if value is not None and value >= 0 else None


def _valid_growth(*values: Any) -> float | None:
    value = _first_number(*values)
    return value if value is not None and value <= 9 else None


def _positive_ratio(numerator: Any, denominator: Any) -> float | None:
    numerator_value = _positive_number(numerator)
    denominator_value = _positive_number(denominator)
    if numerator_value is None or denominator_value is None:
        return None
    return numerator_value / denominator_value


def _margin_from_values(numerator: Any, denominator: Any) -> float | None:
    numerator_value = _first_number(numerator)
    denominator_value = _first_number(denominator)
    if numerator_value is None or denominator_value is None or denominator_value == 0:
        return None
    return numerator_value / denominator_value


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max(value, min_value), max_value)


def _round_score(value: float) -> float:
    return round(value + 1e-12, 2)


def _display_ticker(value: str) -> str:
    return _clean_text(value).upper()


def _yahoo_ticker(value: str) -> str:
    return _display_ticker(value).replace(".", "-")


def _config(universe: str) -> Dict[str, str]:
    key = _clean_text(universe).lower()
    if key not in UNIVERSE_CONFIGS:
        raise ValueError(f"Unsupported screener universe: {universe}")
    return UNIVERSE_CONFIGS[key]


def _cache_path(universe: str) -> Path:
    return Path(__file__).resolve().parents[1] / "outputs" / "_screeners" / _config(universe)["cache_file"]


def _seed_path(universe: str) -> Path:
    return Path(__file__).resolve().parents[1] / "src" / "ai_hedge" / "static_data" / _config(universe)["seed_file"]


def _scored_seed_path(universe: str) -> Path:
    return Path(__file__).resolve().parents[1] / "src" / "ai_hedge" / "static_data" / _config(universe)["scored_seed_file"]


def _load_cache(max_age_minutes: int, universe: str) -> Dict[str, Any] | None:
    path = _cache_path(universe)
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


def _load_cached_profile_map(universe: str) -> Dict[str, Dict[str, str]]:
    path = _cache_path(universe)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    rows = payload.get("rows")
    if not isinstance(rows, list):
        return {}
    profiles: Dict[str, Dict[str, str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        ticker = _clean_text(row.get("query_ticker") or row.get("ticker")).upper()
        sector = _group_key(str(row.get("sector") or ""))
        industry = _group_key(str(row.get("industry") or ""))
        if ticker and (sector or industry):
            profiles[ticker] = {
                "sector": sector or "",
                "industry": industry or "",
            }
    return profiles


def _write_cache(payload: Dict[str, Any], universe: str) -> None:
    path = _cache_path(universe)
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
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        return response.text
    except Exception:
        try:
            from curl_cffi import requests as curl_requests

            response = curl_requests.get(url, headers=headers, impersonate="chrome120", timeout=20)
            response.raise_for_status()
            return response.text
        except Exception:
            raise


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


def _ta_query_candidates(ticker: str) -> List[str]:
    base = _display_ticker(ticker).replace(".TA", "")
    return [base, f"{base}.TA"] if base else []


def _load_platform_tickers() -> set[str]:
    raw = os.environ.get("SCREENER_PLATFORM_TICKERS") or ""
    if not raw.strip():
        return set()
    try:
        payload = json.loads(raw)
    except Exception:
        return set()
    if not isinstance(payload, list):
        return set()
    return {_clean_text(item).upper() for item in payload if _clean_text(item)}


def _ta_platform_preferred_ticker(ticker: str, platform_tickers: set[str]) -> str | None:
    base = _display_ticker(ticker).replace(".TA", "")
    if not base:
        return None
    if base in platform_tickers:
        return base
    ta_ticker = f"{base}.TA"
    if ta_ticker in platform_tickers:
        return ta_ticker
    return None


def _apply_platform_ticker_preferences(rows: List[Dict[str, Any]], universe: str) -> List[Dict[str, Any]]:
    if universe != "ta125":
        return rows
    platform_tickers = _load_platform_tickers()
    preferred_rows: List[Dict[str, Any]] = []
    for row in rows:
        raw_ticker = str(row.get("ticker") or "")
        preferred = _ta_platform_preferred_ticker(raw_ticker, platform_tickers)
        preference_source = "platform_reports" if preferred else "ta_suffix_default"
        if not preferred:
            base = _display_ticker(raw_ticker).replace(".TA", "")
            preferred = f"{base}.TA" if base else ""
        next_row = dict(row)
        next_row["query_ticker"] = preferred
        next_row["query_candidates"] = [preferred] if preferred else []
        next_row["forced_query_ticker"] = preferred
        next_row["ticker_preference_source"] = preference_source
        if preference_source == "platform_reports":
            next_row["platform_preferred_ticker"] = preferred
        preferred_rows.append(next_row)
    return preferred_rows


def _row_query_candidates(row: Dict[str, Any]) -> List[str]:
    raw_candidates = row.get("query_candidates")
    candidates: List[str] = []
    if isinstance(raw_candidates, list):
        candidates.extend(str(item) for item in raw_candidates)
    if row.get("query_ticker"):
        candidates.append(str(row["query_ticker"]))
    if row.get("ticker"):
        candidates.append(_yahoo_ticker(str(row["ticker"])))
    clean_candidates: List[str] = []
    for candidate in candidates:
        symbol = _clean_text(candidate).upper()
        if symbol and symbol not in clean_candidates:
            clean_candidates.append(symbol)
    return clean_candidates


def _has_usable_data(profile: Dict[str, Any], analysis: Dict[str, Any]) -> bool:
    if _clean_text(profile.get("sector")) or _clean_text(profile.get("industry")):
        return True
    if _positive_number(analysis.get("currentPrice")) is not None:
        return True
    return any(
        _normalized_metric_value(metric, analysis.get(metric)) is not None
        for metric in (*VALUATION_METRIC_KEYS, *QUALITY_METRIC_KEYS)
    )


def _select_query_ticker(
    candidates: List[str],
    profiles: Dict[str, Dict[str, Any]],
    analyses: Dict[str, Dict[str, Any]],
) -> str:
    for candidate in candidates:
        if _has_usable_data(profiles.get(candidate) or {}, analyses.get(candidate) or {}):
            return candidate
    return candidates[0] if candidates else ""


def _first_candidate_price(candidates: List[str], analyses: Dict[str, Dict[str, Any]]) -> float | None:
    for candidate in candidates:
        price = _positive_number((analyses.get(candidate) or {}).get("currentPrice"))
        if price is not None:
            return price
    return None


def _load_universe_seed(universe: str) -> List[Dict[str, Any]]:
    try:
        payload = json.loads(_seed_path(universe).read_text(encoding="utf-8"))
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
                "query_ticker": _clean_text(raw.get("query_ticker")) or _yahoo_ticker(ticker),
                "query_candidates": raw.get("query_candidates") if isinstance(raw.get("query_candidates"), list) else None,
                "company_name": company,
            }
        )
    return rows


def _fetch_ta125_tradingview_rows() -> List[Dict[str, Any]]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": TRADINGVIEW_TA125_URL,
    }
    columns = ["name", "description", "market_cap_basic", "indexes", "sector", "exchange", "typespecs"]
    body = {
        "columns": columns,
        "range": [0, 1200],
        "options": {"lang": "he_IL"},
        "markets": ["israel"],
        "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
    }
    response = requests.post(TRADINGVIEW_ISRAEL_SCAN_URL, headers=headers, json=body, timeout=20)
    response.raise_for_status()
    payload = json.loads(response.content.decode("utf-8"))
    rows: List[Dict[str, Any]] = []
    for item in payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        values = item.get("d") or []
        indexes = values[3] if len(values) > 3 else []
        if not any(
            isinstance(index, dict)
            and (index.get("proname") == "TASE:TA125" or index.get("name") == "TA-125")
            for index in indexes or []
        ):
            continue
        ticker = _display_ticker(values[0] if values else item.get("s", "").replace("TASE:", ""))
        company = _clean_text(values[1] if len(values) > 1 else ticker) or ticker
        if not ticker:
            continue
        rows.append(
            {
                "rank": len(rows) + 1,
                "ticker": ticker,
                "query_ticker": ticker,
                "query_candidates": _ta_query_candidates(ticker),
                "company_name": company,
            }
        )
    return rows


def _fetch_universe(universe: str) -> Tuple[List[Dict[str, Any]], str, str]:
    config = _config(universe)
    if universe == "ta125":
        try:
            rows = _fetch_ta125_tradingview_rows()
            if rows:
                return rows, "tradingview", config["source_url"]
        except Exception:
            pass
        seed_rows = _load_universe_seed(universe)
        if seed_rows:
            return seed_rows, "tradingview-seed", config["source_url"]
        raise RuntimeError("No TA-125 holdings were found.")

    try:
        rows = _parse_slickcharts_rows(_get_html(config["source_url"]))
        if rows:
            return rows, "slickcharts", config["source_url"]
    except Exception:
        pass

    seed_rows = _load_universe_seed(universe)
    if seed_rows:
        return seed_rows, "slickcharts-seed", config["source_url"]

    if universe != "sp500":
        raise RuntimeError(f"No {config['label']} holdings were found.")

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
        payload = Ticker(chunk, timeout=12).asset_profile
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
                for retry_chunk in _chunks(futures[future], 10):
                    try:
                        profiles.update(fetch_chunk(retry_chunk))
                    except Exception:
                        for symbol in retry_chunk:
                            profiles.setdefault(symbol, {})
    return profiles


def _module_for_symbol(payload: Any, symbol: str) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    value = payload.get(symbol) or payload.get(symbol.upper()) or payload.get(symbol.lower())
    return _json_safe(value) if isinstance(value, dict) else {}


def _normalize_valuations(value: Any, symbol: str) -> List[Dict[str, Any]]:
    if not isinstance(value, pd.DataFrame) or value.empty:
        return []
    frame = value.reset_index()
    if "symbol" in frame.columns:
        frame = frame[frame["symbol"].astype(str).str.lower() == symbol.lower()]
    records = frame.astype(object).where(pd.notna(frame), None).to_dict(orient="records")
    return [_json_safe(record) for record in records if isinstance(record, dict)]


def _latest_valuation_snapshot(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not rows:
        return {}
    latest_date = max(str(row.get("asOfDate") or "") for row in rows)
    same_date = [row for row in rows if str(row.get("asOfDate") or "") == latest_date]
    merged: Dict[str, Any] = {}
    for row in sorted(same_date, key=lambda item: item.get("periodType") != "TTM"):
        for key, value in row.items():
            if value is not None:
                merged[key] = value
    return merged


def _compact_analysis(
    financial_data: Dict[str, Any],
    latest_valuation: Dict[str, Any],
    modules: Dict[str, Any],
) -> Dict[str, Any]:
    financial_data = financial_data if isinstance(financial_data, dict) else {}
    latest_valuation = latest_valuation if isinstance(latest_valuation, dict) else {}
    key_stats = modules.get("defaultKeyStatistics")
    summary_detail = modules.get("summaryDetail")
    key_stats = key_stats if isinstance(key_stats, dict) else {}
    summary_detail = summary_detail if isinstance(summary_detail, dict) else {}
    return {
        "currentPrice": _positive_number(
            financial_data.get("currentPrice"),
            summary_detail.get("regularMarketPrice"),
        ),
        "peRatio": _positive_number(
            latest_valuation.get("PeRatio"),
            summary_detail.get("trailingPE"),
            key_stats.get("trailingPE"),
        ),
        "pbRatio": _positive_number(latest_valuation.get("PbRatio")),
        "evToEbitda": _positive_number(
            latest_valuation.get("EnterprisesValueEBITDARatio"),
            key_stats.get("enterpriseToEbitda"),
        ),
        "evToRevenue": _positive_number(
            latest_valuation.get("EnterprisesValueRevenueRatio"),
            key_stats.get("enterpriseToRevenue"),
        ),
        "evToFcf": _positive_ratio(latest_valuation.get("EnterpriseValue"), financial_data.get("freeCashflow"))
        or _positive_ratio(key_stats.get("enterpriseValue"), financial_data.get("freeCashflow")),
        "currentRatio": _first_number(financial_data.get("currentRatio")),
        "quickRatio": _first_number(financial_data.get("quickRatio")),
        "debtToEquity": _non_negative_number(financial_data.get("debtToEquity")),
        "revenueGrowth": _valid_growth(financial_data.get("revenueGrowth")),
        "earningsGrowth": _valid_growth(financial_data.get("earningsGrowth")),
        "roa": _first_number(financial_data.get("returnOnAssets")),
        "roe": _first_number(financial_data.get("returnOnEquity")),
        "grossMargin": _first_number(financial_data.get("grossMargins")),
        "ebitdaMargin": _first_number(financial_data.get("ebitdaMargins")),
        "operatingMargin": _first_number(financial_data.get("operatingMargins")),
        "netProfitMargin": _first_number(financial_data.get("profitMargins")),
        "fcfMargin": _margin_from_values(financial_data.get("freeCashflow"), financial_data.get("totalRevenue")),
    }


def _fetch_analysis_data(symbols: List[str], workers: int) -> Dict[str, Dict[str, Any]]:
    try:
        from yahooquery import Ticker
    except Exception as exc:
        raise RuntimeError(f"yahooquery import failed: {type(exc).__name__}: {str(exc)[:240]}") from exc

    analyses: Dict[str, Dict[str, Any]] = {}

    def fetch_chunk(chunk: List[str]) -> Dict[str, Dict[str, Any]]:
        tickers = Ticker(chunk, asynchronous=True, max_workers=max(1, min(int(workers or 1), 6, len(chunk))), timeout=12)
        financial_response = tickers.financial_data
        valuations_frame = tickers.valuation_measures
        modules = tickers.get_modules(["defaultKeyStatistics", "summaryDetail"])
        chunk_rows: Dict[str, Dict[str, Any]] = {}
        for symbol in chunk:
            financial_data = _module_for_symbol(financial_response, symbol)
            valuations = _normalize_valuations(valuations_frame, symbol)
            latest_valuation = _latest_valuation_snapshot(valuations)
            module_data = _module_for_symbol(modules, symbol)
            chunk_rows[symbol] = _compact_analysis(financial_data, latest_valuation, module_data)
        return chunk_rows

    chunked = list(_chunks(symbols, 50))
    with ThreadPoolExecutor(max_workers=max(1, min(int(workers or 1), 3))) as pool:
        futures = {pool.submit(fetch_chunk, chunk): chunk for chunk in chunked}
        for future in as_completed(futures):
            try:
                analyses.update(future.result())
            except Exception:
                for retry_chunk in _chunks(futures[future], 10):
                    try:
                        analyses.update(fetch_chunk(retry_chunk))
                    except Exception:
                        for symbol in retry_chunk:
                            analyses.setdefault(symbol, {})
    return analyses


def _metric_config(metric: str) -> Dict[str, Any]:
    return VALUATION_CONFIGS.get(metric) or QUALITY_CONFIGS[metric]


def _normalized_metric_value(metric: str, value: Any) -> float | None:
    config = _metric_config(metric)
    if metric in VALUATION_CONFIGS:
        normalized = _positive_number(value)
    elif metric == "debtToEquity":
        normalized = _non_negative_number(value)
    else:
        normalized = _first_number(value)
    if normalized is None:
        return None
    clamp = config.get("clamp")
    if clamp:
        return _clamp(normalized, float(clamp["min"]), float(clamp["max"]))
    return normalized


def _empty_group_store() -> Dict[str, List[float]]:
    return {metric: [] for metric in (*VALUATION_METRIC_KEYS, *QUALITY_METRIC_KEYS)}


def _average(values: List[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _group_key(value: str) -> str | None:
    text = _clean_text(value)
    return text if text and text.lower() != "unknown" else None


def _percentile_score(value: float, peers: List[float], direction: str) -> float:
    if not peers:
        return 0.0
    better = sum(1 for peer in peers if value < peer) if direction == "lower" else sum(1 for peer in peers if value > peer)
    equal = sum(1 for peer in peers if peer == value)
    return ((better + (equal * 0.5)) / len(peers)) * 100


def _peer_blend_weights(industry_company_count: int) -> Dict[str, float]:
    if industry_company_count <= SMALL_INDUSTRY_MAX_COUNT:
        return {"sector": 0.70, "industry": 0.30}
    if industry_company_count <= MEDIUM_INDUSTRY_MAX_COUNT:
        return {"sector": 0.50, "industry": 0.50}
    return {"sector": 0.30, "industry": 0.70}


def _blended_percentile(
    metric: str,
    value: float,
    direction: str,
    sector: str | None,
    industry: str | None,
    sector_values: Dict[str, Dict[str, List[float]]],
    industry_values: Dict[str, Dict[str, List[float]]],
    industry_counts: Dict[str, int],
) -> float | None:
    contributions: List[Dict[str, float]] = []
    industry_peers = industry_values.get(industry or "", {}).get(metric, []) if industry else []
    sector_peers = sector_values.get(sector or "", {}).get(metric, []) if sector else []
    weights = _peer_blend_weights(industry_counts.get(industry or "", 0))
    if industry_peers:
        contributions.append({
            "weight": weights["industry"],
            "percentile": _percentile_score(value, industry_peers, direction),
        })
    if sector_peers:
        contributions.append({
            "weight": weights["sector"],
            "percentile": _percentile_score(value, sector_peers, direction),
        })
    if not contributions:
        return None
    total_weight = sum(item["weight"] for item in contributions)
    return sum(item["percentile"] * item["weight"] for item in contributions) / total_weight


def _weighted_category_score(
    analysis: Dict[str, Any],
    metrics: Tuple[str, ...],
    configs: Dict[str, Dict[str, Any]],
    sector: str | None,
    industry: str | None,
    sector_values: Dict[str, Dict[str, List[float]]],
    industry_values: Dict[str, Dict[str, List[float]]],
    industry_counts: Dict[str, int],
) -> float:
    weighted_sum = 0.0
    used_weight = 0.0
    for metric in metrics:
        value = _normalized_metric_value(metric, analysis.get(metric))
        if value is None:
            continue
        percentile = _blended_percentile(
            metric,
            value,
            str(configs[metric]["direction"]),
            sector,
            industry,
            sector_values,
            industry_values,
            industry_counts,
        )
        if percentile is None:
            continue
        weight = float(configs[metric]["weight"])
        weighted_sum += percentile * weight
        used_weight += weight
    return _round_score(weighted_sum / used_weight) if used_weight else 0.0


def _category_coverage(analysis: Dict[str, Any], metrics: Tuple[str, ...], configs: Dict[str, Dict[str, Any]]) -> float:
    available_weight = 0.0
    for metric in metrics:
        if _normalized_metric_value(metric, analysis.get(metric)) is not None:
            available_weight += float(configs[metric]["weight"])
    total = sum(float(config["weight"]) for config in configs.values())
    return available_weight / total if total else 0.0


def _calculate_scores(rows: List[Dict[str, Any]]) -> None:
    sector_values: Dict[str, Dict[str, List[float]]] = {}
    industry_values: Dict[str, Dict[str, List[float]]] = {}
    industry_counts: Dict[str, int] = {}
    for row in rows:
        industry = _group_key(str(row.get("industry") or ""))
        if industry:
            industry_counts[industry] = industry_counts.get(industry, 0) + 1

    for row in rows:
        analysis = row.get("analysis")
        if not isinstance(analysis, dict):
            continue
        sector = _group_key(str(row.get("sector") or ""))
        industry = _group_key(str(row.get("industry") or ""))
        for metric in (*VALUATION_METRIC_KEYS, *QUALITY_METRIC_KEYS):
            value = _normalized_metric_value(metric, analysis.get(metric))
            if value is None:
                continue
            if sector:
                sector_values.setdefault(sector, _empty_group_store())[metric].append(value)
            if industry:
                industry_values.setdefault(industry, _empty_group_store())[metric].append(value)

    for row in rows:
        analysis = row.get("analysis") if isinstance(row.get("analysis"), dict) else {}
        sector = _group_key(str(row.get("sector") or ""))
        industry = _group_key(str(row.get("industry") or ""))
        valuation_score = _weighted_category_score(
            analysis,
            VALUATION_METRIC_KEYS,
            VALUATION_CONFIGS,
            sector,
            industry,
            sector_values,
            industry_values,
            industry_counts,
        )
        quality_score = _weighted_category_score(
            analysis,
            QUALITY_METRIC_KEYS,
            QUALITY_CONFIGS,
            sector,
            industry,
            sector_values,
            industry_values,
            industry_counts,
        )
        valuation_coverage = _category_coverage(analysis, VALUATION_METRIC_KEYS, VALUATION_CONFIGS)
        quality_coverage = _category_coverage(analysis, QUALITY_METRIC_KEYS, QUALITY_CONFIGS)
        confidence = ((valuation_coverage * sum(config["weight"] for config in VALUATION_CONFIGS.values()))
            + (quality_coverage * sum(config["weight"] for config in QUALITY_CONFIGS.values()))) / (
            sum(config["weight"] for config in VALUATION_CONFIGS.values()) + sum(config["weight"] for config in QUALITY_CONFIGS.values())
        )
        row["valuation_score"] = valuation_score
        row["quality_score"] = quality_score
        row["overall_score"] = _round_score((valuation_score * 0.45) + (quality_score * 0.55))
        row["score_confidence"] = _round_score(confidence * 100)
        row["valuation_coverage"] = _round_score(valuation_coverage * 100)
        row["quality_coverage"] = _round_score(quality_coverage * 100)


def build_payload(max_age_minutes: int, refresh: bool, workers: int, universe_key: str = "sp500") -> Dict[str, Any]:
    universe_key = _clean_text(universe_key).lower() or "sp500"
    config = _config(universe_key)
    if not refresh:
        cached = _load_cache(max_age_minutes, universe_key)
        if cached:
            cached = dict(cached)
            cached["cache_hit"] = True
            return cached

    universe, source, source_url = _fetch_universe(universe_key)
    universe = _apply_platform_ticker_preferences(universe, universe_key)
    cached_profile_map = _load_cached_profile_map(universe_key)
    symbols: List[str] = []
    for row in universe:
        for candidate in _row_query_candidates(row):
            if candidate not in symbols:
                symbols.append(candidate)
    with ThreadPoolExecutor(max_workers=2) as pool:
        profiles_future = pool.submit(_fetch_asset_profiles, symbols, workers)
        analyses_future = pool.submit(_fetch_analysis_data, symbols, workers)
        profiles = profiles_future.result()
        analyses = analyses_future.result()
    generated_at = datetime.now(timezone.utc).isoformat()
    rows: List[Dict[str, Any]] = []
    missing_profiles = 0
    missing_scores = 0

    for row in universe:
        candidates = _row_query_candidates(row)
        forced_query_ticker = _clean_text(row.get("forced_query_ticker")) or _clean_text(row.get("platform_preferred_ticker"))
        query_ticker = forced_query_ticker or _select_query_ticker(candidates, profiles, analyses)
        profile = profiles.get(query_ticker) or {}
        analysis = analyses.get(query_ticker) or {}
        sector = _clean_text(profile.get("sector"))
        industry = _clean_text(profile.get("industry"))
        cached_profile = {}
        for candidate in [query_ticker, *candidates, str(row.get("ticker") or "")]:
            cached_profile = cached_profile_map.get(_clean_text(candidate).upper()) or {}
            if cached_profile:
                break
        if not sector:
            sector = _clean_text(cached_profile.get("sector"))
        if not industry:
            industry = _clean_text(cached_profile.get("industry"))
        if not sector and not industry:
            missing_profiles += 1
        if not any(_normalized_metric_value(metric, analysis.get(metric)) is not None for metric in (*VALUATION_METRIC_KEYS, *QUALITY_METRIC_KEYS)):
            missing_scores += 1
        current_price = _positive_number(analysis.get("currentPrice"))
        if not forced_query_ticker:
            current_price = current_price or _first_candidate_price(candidates, analyses)
        ticker_preference = _clean_text(row.get("ticker_preference_source")) or (
            "platform_reports" if _clean_text(row.get("platform_preferred_ticker")) else "yahooquery_first_available"
        )
        rows.append(
            {
                "rank": row["rank"],
                "ticker": row["ticker"],
                "query_ticker": query_ticker,
                "company_name": row["company_name"],
                "sector": sector or "Unknown",
                "industry": industry or "Unknown",
                "current_price": current_price,
                "ticker_preference": ticker_preference,
                "analysis": analysis,
            }
        )
    _calculate_scores(rows)
    for row in rows:
        row.pop("analysis", None)

    payload = {
        "status": "success",
        "cache_version": CACHE_VERSION,
        "cache_hit": False,
        "generated_at": generated_at,
        "universe": universe_key,
        "universe_label": config["label"],
        "source": source,
        "source_url": source_url,
        "ticker_preference_source": "platform_reports_or_ta_suffix_default" if universe_key == "ta125" else "default",
        "count": len(rows),
        "missing_profiles": missing_profiles,
        "missing_scores": missing_scores,
        "scoring": {
            "method": "samancal_percentile_v2_dynamic_peer_blend",
            "sector_source": "yahooquery.asset_profile.sector",
            "industry_source": "yahooquery.asset_profile.industry",
            "final_score_formula": "0.45 * valuation_score + 0.55 * quality_score",
            "peer_blend_policy": {
                "small_industry": "fewer than 5 companies: 70% sector / 30% industry",
                "medium_industry": "5 to 15 companies: 50% sector / 50% industry",
                "large_industry": "16 or more companies: 30% sector / 70% industry",
            },
            "valuation_metrics": list(VALUATION_METRIC_KEYS),
            "quality_metrics": list(QUALITY_METRIC_KEYS),
        },
        "rows": rows,
    }
    if missing_profiles <= max(5, int(len(rows) * 0.2)):
        _write_cache(payload, universe_key)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a market screener profile table.")
    parser.add_argument("--universe", choices=sorted(UNIVERSE_CONFIGS), default="sp500")
    parser.add_argument("--cache-minutes", type=int, default=720)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    try:
        payload = build_payload(
            max_age_minutes=int(args.cache_minutes or 0),
            refresh=bool(args.refresh),
            workers=int(args.workers or 1),
            universe_key=str(args.universe),
        )
    except Exception as exc:
        universe_key = _clean_text(getattr(args, "universe", "sp500")).lower() or "sp500"
        label = UNIVERSE_CONFIGS.get(universe_key, UNIVERSE_CONFIGS["sp500"])["label"]
        payload = {
            "status": "error",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "universe": universe_key,
            "universe_label": label,
            "rows": [],
            "error": f"{type(exc).__name__}: {str(exc)[:320]}",
        }
        print(json.dumps(payload, ensure_ascii=False, allow_nan=False))
        return 1

    print(json.dumps(payload, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
