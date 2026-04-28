from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Dict, Optional

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


def _fallback_current_price(ticker: yf.Ticker) -> Optional[float]:
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

    try:
        info = getattr(ticker, "info", None) or {}
    except Exception:
        info = {}
    for key in ("regularMarketPrice", "currentPrice", "previousClose"):
        value = _safe_float(info.get(key))
        if isinstance(value, float) and value > 0:
            return value
    return None


def get_returns_and_current_price(ticker_symbol: str) -> tuple[Dict[str, Optional[float]], Optional[float]]:
    ticker = yf.Ticker(ticker_symbol)
    try:
        hist = ticker.history(period="max")
    except Exception:
        hist = None

    prices = None
    last_price = None
    if hist is not None and not getattr(hist, "empty", True):
        try:
            prices = hist["Close"]
            if prices is not None and not prices.empty:
                last_price = _safe_float(prices.iloc[-1])
        except Exception:
            prices = None
            last_price = None

    current_price = last_price if isinstance(last_price, float) and last_price > 0 else _fallback_current_price(ticker)

    def calc_return(trading_days: int) -> Optional[float]:
        if prices is None or prices.empty:
            return None
        if current_price is None or current_price <= 0:
            return None
        if trading_days <= 0:
            return None
        try:
            past_price = _safe_float(prices.iloc[-trading_days - 1])
        except Exception:
            return None
        if past_price is None or past_price <= 0:
            return None
        return (current_price / past_price - 1.0) * 100.0

    raw = {
        "1D": calc_return(1),
        "1W": calc_return(5),
        "1M": calc_return(21),
        "3M": calc_return(63),
        "6M": calc_return(126),
        "1Y": calc_return(252),
        "3Y": calc_return(252 * 3),
        "5Y": calc_return(252 * 5),
    }
    returns = {k: (round(v, 2) if v is not None else None) for k, v in raw.items()}
    return returns, round(current_price, 4) if isinstance(current_price, float) else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch live return horizons using yfinance.")
    parser.add_argument("--ticker", required=True, help="Ticker symbol, e.g. AAPL")
    args = parser.parse_args()
    ticker = str(args.ticker or "").strip().upper()
    if not ticker:
        print(json.dumps({"error": "Missing ticker", "returns_pct": {}}))
        return 2

    repo_root = Path(__file__).resolve().parents[1]
    _configure_yfinance_cache(repo_root)
    try:
        returns, current_price = get_returns_and_current_price(ticker)
    except Exception as exc:
        print(json.dumps({"ticker": ticker, "returns_pct": {}, "current_price": None, "error": str(exc)}))
        return 1

    print(json.dumps({"ticker": ticker, "returns_pct": returns, "current_price": current_price}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
