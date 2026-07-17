from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from typing import Any, Dict, List

import pandas as pd
import yfinance as yf


def _num(value: Any) -> float | None:
    try:
        if value is None:
            return None
        n = float(value)
        if n != n:
            return None
        return n
    except Exception:
        return None


def _ticker_key(value: str) -> str:
    return str(value or "").strip().upper()


def _dividend_yield_pct(value: Any) -> float | None:
    n = _num(value)
    if n is None:
        return None
    return n * 100.0 if abs(n) <= 0.2 else n


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool, int, float)):
        if isinstance(value, float) and value != value:
            return None
        return value
    if isinstance(value, (datetime, date, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(v) for v in value]
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    return str(value)


def _named_table(df: pd.DataFrame, title: str) -> str:
    try:
        if df is None or getattr(df, "empty", True):
            return f"### {title}\nNot available\n\n"
        table = df.copy().T
        table.index.name = "Reporting_Period"
        table = table.fillna("N/A")
        csv_table = table.to_csv()
        if not csv_table.strip():
            return f"### {title}\nNot available\n\n"
        return f"### {title}\n```csv\n{csv_table}```\n\n"
    except Exception:
        return f"### {title}\nNot available\n\n"


def _financials_copy_payload(
    ticker: str,
    ticker_obj: yf.Ticker,
    info: Dict[str, Any],
    financial_period: str = "annual",
) -> Dict[str, Any]:
    currency = (
        info.get("financialCurrency")
        or info.get("original_financial_currency")
        or info.get("currency")
        or ""
    )
    period = str(financial_period or "annual").strip().lower()
    if period not in {"annual", "quarterly", "both"}:
        period = "annual"
    payload = {
        "ticker": ticker,
        "company_name": info.get("longName") or info.get("shortName") or ticker,
        "currency": str(currency or "").upper() or None,
        "source": "yfinance.Ticker",
        "requested_period": period,
        "statement_format": "markdown-wrapped csv, original reported currency",
        "info": _json_safe(info),
    }
    if period in {"annual", "both"}:
        payload.update(
            {
                "annual_financials": _named_table(ticker_obj.financials, "Annual Income Statement"),
                "annual_balance_sheet": _named_table(ticker_obj.balance_sheet, "Annual Balance Sheet"),
                "annual_cash_flow": _named_table(ticker_obj.cashflow, "Annual Cash Flow Statement"),
            }
        )
    if period in {"quarterly", "both"}:
        payload.update(
            {
                "quarterly_financials": _named_table(ticker_obj.quarterly_financials, "Quarterly Income Statement"),
                "quarterly_balance_sheet": _named_table(ticker_obj.quarterly_balance_sheet, "Quarterly Balance Sheet"),
                "quarterly_cash_flow": _named_table(ticker_obj.quarterly_cashflow, "Quarterly Cash Flow Statement"),
            }
        )
    return payload


def _row(symbol: str, include_financials: bool = False, financial_period: str = "annual") -> Dict[str, Any]:
    ticker = _ticker_key(symbol)
    ticker_obj = yf.Ticker(ticker)
    info = ticker_obj.info or {}
    if not isinstance(info, dict):
        info = {}

    resolved = _ticker_key(str(info.get("symbol") or ticker))
    name = str(info.get("longName") or info.get("shortName") or "").strip()
    quote_type = str(info.get("quoteType") or "").strip()
    if not name and not quote_type and not info.get("regularMarketPrice") and not info.get("currentPrice"):
        return {"ticker": ticker, "ok": False}

    current_price = _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice"))
    target_price = _num(info.get("targetMeanPrice"))
    market_cap = _num(info.get("marketCap"))
    ev = _num(info.get("enterpriseValue"))
    fcf = _num(info.get("freeCashflow"))
    upside = None
    if current_price and target_price:
        upside = (target_price / current_price - 1.0) * 100.0

    row = {
        "ticker": ticker,
        "ok": True,
        "symbol": resolved or ticker,
        "company_name": name or ticker,
        "market_cap": market_cap,
        "enterprise_value": ev,
        "net_cash_debt": (market_cap - ev) if market_cap is not None and ev is not None else None,
        "trailing_pe": _num(info.get("trailingPE")),
        "forward_pe": _num(info.get("forwardPE")),
        "ev_sales": _num(info.get("enterpriseToRevenue")),
        "ev_ebitda": _num(info.get("enterpriseToEbitda")),
        "p_fcf": (market_cap / fcf) if market_cap is not None and fcf not in (None, 0) else None,
        "revenue_growth": (_num(info.get("revenueGrowth")) * 100.0) if _num(info.get("revenueGrowth")) is not None else None,
        "earnings_growth": (_num(info.get("earningsGrowth")) * 100.0) if _num(info.get("earningsGrowth")) is not None else None,
        "gross_margin": (_num(info.get("grossMargins")) * 100.0) if _num(info.get("grossMargins")) is not None else None,
        "operating_margin": (_num(info.get("operatingMargins")) * 100.0) if _num(info.get("operatingMargins")) is not None else None,
        "profit_margin": (_num(info.get("profitMargins")) * 100.0) if _num(info.get("profitMargins")) is not None else None,
        "roe": (_num(info.get("returnOnEquity")) * 100.0) if _num(info.get("returnOnEquity")) is not None else None,
        "current_ratio": _num(info.get("currentRatio")),
        "debt_to_equity": _num(info.get("debtToEquity")),
        "dividend_yield": _dividend_yield_pct(info.get("dividendYield")),
        "target_upside": upside,
    }
    if include_financials:
        row["financials_copy"] = _financials_copy_payload(ticker, ticker_obj, info, financial_period)
    return row


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tickers", required=True)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--include-financials", action="store_true")
    parser.add_argument("--financial-period", choices=["annual", "quarterly", "both"], default="annual")
    args = parser.parse_args()

    tickers: List[str] = []
    seen: set[str] = set()
    for raw in str(args.tickers or "").split(","):
        ticker = _ticker_key(raw)
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        tickers.append(ticker)

    rows: List[Dict[str, Any]] = []
    not_found: List[str] = []
    with ThreadPoolExecutor(max_workers=max(1, min(int(args.workers or 1), 10))) as pool:
        futures = {
            pool.submit(_row, ticker, bool(args.include_financials), str(args.financial_period)): ticker
            for ticker in tickers
        }
        for fut in as_completed(futures):
            ticker = futures[fut]
            try:
                row = fut.result()
            except Exception:
                row = {"ticker": ticker, "ok": False}
            if row.get("ok"):
                rows.append(row)
            else:
                not_found.append(ticker)

    order = {ticker: idx for idx, ticker in enumerate(tickers)}
    rows.sort(key=lambda row: order.get(_ticker_key(str(row.get("ticker") or "")), 999))
    print(json.dumps({"rows": rows, "not_found": not_found}, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
