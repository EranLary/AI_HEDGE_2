from __future__ import annotations

import argparse
import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional

import yfinance as yf


def _safe_float(v: object) -> Optional[float]:
    try:
        n = float(v)  # type: ignore[arg-type]
    except Exception:
        return None
    if math.isnan(n) or math.isinf(n):
        return None
    return n


def _configure_yfinance_cache(repo_root: Path) -> None:
    try:
        cache_dir = repo_root / ".yfinance_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        if hasattr(yf, "set_tz_cache_location"):
            yf.set_tz_cache_location(str(cache_dir))
    except Exception:
        pass


def _fallback_from_fast_info(ticker: yf.Ticker) -> Optional[float]:
    try:
        fi = getattr(ticker, "fast_info", None)
    except Exception:
        fi = None
    if fi is not None:
        for key in ("last_price", "regularMarketPrice", "previous_close"):
            try:
                value = _safe_float(fi.get(key)) if hasattr(fi, "get") else _safe_float(getattr(fi, key, None))
            except Exception:
                value = None
            if isinstance(value, float) and value > 0:
                return value
    return None


def _fallback_from_info(ticker: yf.Ticker) -> Optional[float]:
    try:
        info = getattr(ticker, "info", None) or {}
    except Exception:
        info = {}
    for key in ("regularMarketPrice", "currentPrice", "previousClose"):
        value = _safe_float(info.get(key))
        if isinstance(value, float) and value > 0:
            return value
    return None


def fetch_current_price(symbol: str) -> Optional[float]:
    tk = yf.Ticker(symbol)
    try:
        hist = tk.history(period="5d")
    except Exception:
        hist = None

    if hist is not None and not getattr(hist, "empty", True):
        try:
            prices = hist["Close"]
            if prices is not None and not prices.empty:
                p = _safe_float(prices.iloc[-1])
                if isinstance(p, float) and p > 0:
                    return round(p, 4)
        except Exception:
            pass

    p2 = _fallback_from_fast_info(tk)
    if isinstance(p2, float) and p2 > 0:
        return round(p2, 4)
    p3 = _fallback_from_info(tk)
    if isinstance(p3, float) and p3 > 0:
        return round(p3, 4)
    return None


def parse_tickers(raw: str) -> List[str]:
    values = [part.strip().upper() for part in str(raw or "").split(",")]
    uniq: List[str] = []
    seen = set()
    for value in values:
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        uniq.append(value)
    return uniq


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch live current prices for many tickers using threaded yfinance calls.")
    parser.add_argument("--tickers", required=True, help="Comma-separated tickers, e.g. AAPL,MSFT,NVDA")
    parser.add_argument("--workers", type=int, default=12, help="Max worker threads")
    args = parser.parse_args()

    tickers = parse_tickers(args.tickers)
    if not tickers:
        print(json.dumps({"prices": {}}))
        return 0

    repo_root = Path(__file__).resolve().parents[1]
    _configure_yfinance_cache(repo_root)

    workers = max(2, min(int(args.workers or 12), 32))
    prices: Dict[str, Optional[float]] = {ticker: None for ticker in tickers}

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_ticker = {executor.submit(fetch_current_price, ticker): ticker for ticker in tickers}
        for future in as_completed(future_to_ticker):
            ticker = future_to_ticker[future]
            try:
                prices[ticker] = future.result()
            except Exception:
                prices[ticker] = None

    print(json.dumps({"prices": prices}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

