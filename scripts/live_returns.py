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


def get_returns(ticker_symbol: str) -> Dict[str, Optional[float]]:
    ticker = yf.Ticker(ticker_symbol)
    hist = ticker.history(period="max")
    if hist is None or hist.empty:
        return {}

    prices = hist["Close"]
    if prices is None or prices.empty:
        return {}
    last_price = _safe_float(prices.iloc[-1])
    if last_price is None or last_price <= 0:
        return {}

    def calc_return(trading_days: int) -> Optional[float]:
        if trading_days <= 0:
            return None
        try:
            past_price = _safe_float(prices.iloc[-trading_days - 1])
        except Exception:
            return None
        if past_price is None or past_price <= 0:
            return None
        return (last_price / past_price - 1.0) * 100.0

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
    return {k: (round(v, 2) if v is not None else None) for k, v in raw.items()}


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
        returns = get_returns(ticker)
    except Exception as exc:
        print(json.dumps({"ticker": ticker, "returns_pct": {}, "error": str(exc)}))
        return 1

    print(json.dumps({"ticker": ticker, "returns_pct": returns}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
