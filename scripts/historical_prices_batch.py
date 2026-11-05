"""Fetch split-only-adjusted daily price history for Track Record metrics."""
from __future__ import annotations

import argparse
import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import yfinance as yf


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _configure_yfinance_cache(repo_root: Path) -> None:
    try:
        cache_dir = repo_root / ".yfinance_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        if hasattr(yf, "set_tz_cache_location"):
            yf.set_tz_cache_location(str(cache_dir))
    except Exception:
        pass


def _parse_tickers(raw: str) -> list[str]:
    values = [part.strip().upper() for part in str(raw or "").split(",")]
    return list(dict.fromkeys(value for value in values if value))


def _split_adjust_rows(raw_rows: list[tuple[date, float, float | None]]) -> list[dict[str, Any]]:
    """Attach the factor that normalizes a saved quote to Yahoo's share basis."""
    cumulative_future_split = 1.0
    adjusted_reversed: list[dict[str, Any]] = []
    for row_date, close, split_ratio in reversed(raw_rows):
        adjusted_reversed.append(
            {
                "date": row_date.isoformat(),
                "close": round(close, 8),
                "split_factor": round(1.0 / cumulative_future_split, 12),
            }
        )
        # Yahoo already revises historical Close values for splits. The event
        # ratio is needed only to normalize a quote saved before a later split.
        # A split-date quote is already post-split, so apply its ratio only to
        # earlier report dates when walking backward through the series.
        if split_ratio is not None:
            cumulative_future_split *= split_ratio
    return list(reversed(adjusted_reversed))


def _history(ticker: str, start: date, end: date) -> list[dict[str, Any]]:
    frame = yf.Ticker(ticker).history(
        start=start.isoformat(),
        end=(end + timedelta(days=1)).isoformat(),
        auto_adjust=False,
        actions=True,
    )
    if frame is None or frame.empty or "Close" not in frame.columns:
        return []
    split_column = frame["Stock Splits"] if "Stock Splits" in frame.columns else None
    raw_rows: list[tuple[date, float, float | None]] = []
    for index, close_value in frame["Close"].items():
        close = _safe_float(close_value)
        if close is None:
            continue
        row_date = index.date() if hasattr(index, "date") else date.fromisoformat(str(index)[:10])
        split_ratio = _safe_float(split_column.loc[index]) if split_column is not None else None
        raw_rows.append((row_date, close, split_ratio))
    return _split_adjust_rows(raw_rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", required=True, help="Comma-separated ticker symbols")
    parser.add_argument("--start", required=True, help="Inclusive start date (YYYY-MM-DD)")
    parser.add_argument("--end", default=date.today().isoformat(), help="Inclusive end date (YYYY-MM-DD)")
    parser.add_argument("--workers", type=int, default=12, help="Maximum concurrent provider calls")
    args = parser.parse_args()

    tickers = _parse_tickers(args.tickers)
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    if start > end:
        raise SystemExit("--start must be on or before --end")

    _configure_yfinance_cache(Path(__file__).resolve().parents[1])
    prices: dict[str, list[dict[str, Any]]] = {ticker: [] for ticker in tickers}
    errors: dict[str, str] = {}
    workers = max(2, min(int(args.workers or 12), 32))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_ticker = {
            executor.submit(_history, ticker, start, end): ticker
            for ticker in tickers
        }
        for future in as_completed(future_to_ticker):
            ticker = future_to_ticker[future]
            try:
                prices[ticker] = future.result()
            except Exception as exc:
                errors[ticker] = str(exc)

    print(json.dumps({"prices": prices, "errors": errors}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
