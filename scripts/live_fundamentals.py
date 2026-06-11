from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Dict, Optional

import yfinance as yf


def _safe_float(value: Any) -> Optional[float]:
    try:
        n = float(value)
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


def fetch_fundamentals(symbol: str) -> Dict[str, Any]:
    ticker = yf.Ticker(symbol)
    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    revenue = _safe_float(info.get("totalRevenue"))
    earnings = _safe_float(info.get("netIncomeToCommon"))
    fcf = _safe_float(info.get("freeCashflow"))
    ev = _safe_float(info.get("enterpriseValue"))
    market_cap = _safe_float(info.get("marketCap"))

    ev_sales = _safe_float(info.get("enterpriseToRevenue"))
    if ev_sales is None and ev is not None and revenue not in (None, 0):
        ev_sales = ev / revenue

    pe = _safe_float(info.get("trailingPE"))
    if pe is None and market_cap is not None and earnings not in (None, 0):
        pe = market_cap / earnings

    financial_currency = str(info.get("financialCurrency") or info.get("currency") or "USD").upper()

    return {
        "ticker": symbol.upper(),
        "financial_currency": financial_currency,
        "assumption_current_values": {
            "representative_fcf": fcf,
            "representative_revenue": revenue,
            "representative_ev_sales": ev_sales,
            "representative_earnings": earnings,
            "representative_pe": pe,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch current yfinance fundamentals for dashboard assumptions.")
    parser.add_argument("--ticker", required=True)
    args = parser.parse_args()

    symbol = str(args.ticker or "").strip().upper()
    repo_root = Path(__file__).resolve().parents[1]
    _configure_yfinance_cache(repo_root)
    print(json.dumps(fetch_fundamentals(symbol)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
