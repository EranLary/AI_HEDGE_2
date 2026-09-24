"""Resolve matured Jev forecasts against split-adjusted daily market closes."""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yfinance as yf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

from ai_hedge.db.connection import get_conn  # noqa: E402
from ai_hedge.jev import QUESTION_VERSION  # noqa: E402


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _pending_rows(workspace: str, limit: int) -> list[dict[str, Any]]:
    workspace_filter = "" if workspace == "all" else "AND r.workspace = %s"
    params: list[object] = [] if workspace == "all" else [workspace]
    params.append(limit)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT p.run_id::text, p.report_id::text, p.horizon,
                       p.probability_up::float8, p.predicted_up, p.target_at,
                       r.ticker, r.available_at, r.workspace
                  FROM report_jev_predictions p
                  JOIN report_jev_runs j ON j.id = p.run_id
                  JOIN reports r ON r.id = p.report_id
                 WHERE p.outcome_status = 'pending'
                   AND p.target_at <= now()
                   AND j.status = 'completed'
                   AND j.question_version = %s
                   AND r.deleted_at IS NULL
                   {workspace_filter}
                 ORDER BY r.ticker, r.available_at, p.target_at
                 LIMIT %s;
                """,
                [QUESTION_VERSION, *params],
            )
            columns = [item.name for item in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]


def _series_for_ticker(ticker: str, start: date, end: date):
    frame = yf.Ticker(ticker).history(
        start=start.isoformat(),
        end=(end + timedelta(days=1)).isoformat(),
        auto_adjust=False,
        actions=False,
    )
    if frame is None or frame.empty:
        return []
    column = "Adj Close" if "Adj Close" in frame.columns else "Close"
    rows: list[tuple[date, float]] = []
    for index, value in frame[column].items():
        price = _safe_float(value)
        if price is None:
            continue
        row_date = index.date() if hasattr(index, "date") else date.fromisoformat(str(index)[:10])
        rows.append((row_date, price))
    return rows


def _first_on_or_after(prices: list[tuple[date, float]], target: date) -> tuple[date, float] | None:
    return next(((day, price) for day, price in prices if day >= target), None)


def _update_prediction(
    row: dict[str, Any],
    *,
    baseline: tuple[date, float] | None,
    outcome: tuple[date, float] | None,
) -> str:
    if baseline is None or outcome is None:
        # Leave recent gaps pending for weekends, holidays, and delayed vendor data.
        target_date = row["target_at"].date()
        if date.today() - target_date < timedelta(days=14):
            return "pending"
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE report_jev_predictions
                       SET outcome_status = 'unavailable', updated_at = now()
                     WHERE run_id = %s::uuid AND horizon = %s;
                    """,
                    (row["run_id"], row["horizon"]),
                )
            conn.commit()
        return "unavailable"

    baseline_at, baseline_price = baseline
    outcome_at, outcome_price = outcome
    realized_up = outcome_price > baseline_price
    predicted_up = bool(row["predicted_up"])
    probability = float(row["probability_up"])
    brier = (probability - (1.0 if realized_up else 0.0)) ** 2
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE report_jev_predictions
                   SET outcome_status = 'realized',
                       baseline_price = %s,
                       baseline_at = %s,
                       outcome_price = %s,
                       outcome_at = %s,
                       realized_up = %s,
                       was_correct = %s,
                       brier_score = %s,
                       updated_at = now()
                 WHERE run_id = %s::uuid AND horizon = %s;
                """,
                (
                    baseline_price,
                    baseline_at,
                    outcome_price,
                    outcome_at,
                    realized_up,
                    predicted_up == realized_up,
                    brier,
                    row["run_id"],
                    row["horizon"],
                ),
            )
        conn.commit()
    return "realized"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", choices=("analysis", "nasdaq100", "all"), default="all")
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        yf.set_tz_cache_location(str(ROOT / ".yfinance_cache"))
    except Exception:
        pass

    rows = _pending_rows(args.workspace, max(1, args.limit))
    if args.dry_run:
        print(json.dumps({"matured_pending": len(rows), "tickers": sorted({row["ticker"] for row in rows})}, indent=2))
        return 0

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row["ticker"]).upper()].append(row)

    counts = {"realized": 0, "unavailable": 0, "pending": 0, "provider_error": 0}
    today = datetime.now(timezone.utc).date()
    for ticker, ticker_rows in grouped.items():
        start = min(row["available_at"].date() for row in ticker_rows) - timedelta(days=7)
        try:
            prices = _series_for_ticker(ticker, start, today)
        except Exception as exc:
            counts["provider_error"] += len(ticker_rows)
            print(json.dumps({"ticker": ticker, "status": "provider_error", "error": str(exc)}), flush=True)
            continue

        for row in ticker_rows:
            baseline = _first_on_or_after(prices, row["available_at"].date())
            outcome = _first_on_or_after(prices, row["target_at"].date())
            status = _update_prediction(row, baseline=baseline, outcome=outcome)
            counts[status] += 1
        print(json.dumps({"ticker": ticker, "predictions": len(ticker_rows), "prices": len(prices)}), flush=True)

    print(json.dumps({"processed": len(rows), "counts": counts}, indent=2))
    return 1 if counts["provider_error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
