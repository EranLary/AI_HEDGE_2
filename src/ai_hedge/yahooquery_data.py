from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd


VALUATION_MULTIPLE_KEYS = [
    "MarketCap",
    "EnterpriseValue",
    "PeRatio",
    "ForwardPeRatio",
    "PegRatio",
    "PbRatio",
    "PsRatio",
    "EnterprisesValueRevenueRatio",
    "EnterprisesValueEBITDARatio",
]


def _safe_number(value: Any) -> Optional[float]:
    try:
        num = float(value)
    except Exception:
        return None
    if math.isnan(num) or math.isinf(num):
        return None
    return num


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        num = float(value)
        return num if math.isfinite(num) else None
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return str(value)


def _df_records(df: Any) -> List[Dict[str, Any]]:
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return []
    tmp = df.copy()
    if isinstance(tmp.index, pd.MultiIndex):
        tmp = tmp.reset_index()
    else:
        tmp = tmp.reset_index()
    tmp = tmp.dropna(axis=0, how="all").dropna(axis=1, how="all")
    records = tmp.to_dict(orient="records")
    return [_json_safe(row) for row in records if isinstance(row, dict)]


def _latest_records(records: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    latest: Dict[str, Dict[str, Any]] = {}
    for row in records:
        period_type = str(row.get("periodType") or "Unknown").upper()
        date = str(row.get("asOfDate") or "")
        current = latest.get(period_type)
        if current is None or date >= str(current.get("asOfDate") or ""):
            latest[period_type] = row
    return latest


def _latest_preferred(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    latest_by_period = _latest_records(records)
    if latest_by_period.get("TTM"):
        return latest_by_period["TTM"]
    if latest_by_period:
        return sorted(latest_by_period.values(), key=lambda r: str(r.get("asOfDate") or ""))[-1]
    return {}


def _average_recent(records: List[Dict[str, Any]], limit: int = 4) -> Dict[str, Optional[float]]:
    ordered = sorted(records, key=lambda r: str(r.get("asOfDate") or ""))
    recent = ordered[-limit:]
    averages: Dict[str, Optional[float]] = {}
    for key in VALUATION_MULTIPLE_KEYS:
        nums = [_safe_number(row.get(key)) for row in recent]
        nums = [n for n in nums if n is not None]
        averages[key] = round(sum(nums) / len(nums), 6) if nums else None
    return averages


def fetch_yahooquery_snapshot(ticker: str) -> Dict[str, Any]:
    symbol = str(ticker or "").strip().upper()
    if not symbol:
        return {"status": "error", "ticker": symbol, "error": "Missing ticker"}

    try:
        from yahooquery import Ticker
    except Exception as exc:
        return {
            "status": "unavailable",
            "ticker": symbol,
            "error": f"yahooquery import failed: {type(exc).__name__}: {str(exc)[:240]}",
        }

    try:
        ticker_obj = Ticker(symbol)
        valuation_measures = ticker_obj.valuation_measures
        financial_data = ticker_obj.financial_data
    except Exception as exc:
        return {
            "status": "error",
            "ticker": symbol,
            "error": f"yahooquery fetch failed: {type(exc).__name__}: {str(exc)[:240]}",
        }

    valuation_rows = _df_records(valuation_measures)
    if isinstance(financial_data, dict):
        raw_financial_data = financial_data.get(symbol) or financial_data
    else:
        raw_financial_data = {}
    financial_data_clean = _json_safe(raw_financial_data if isinstance(raw_financial_data, dict) else {})
    latest_by_period = _latest_records(valuation_rows)
    latest = _latest_preferred(valuation_rows)

    return {
        "status": "success",
        "ticker": symbol,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "valuation_measures": {
            "rows": valuation_rows,
            "columns": list(valuation_measures.columns) if isinstance(valuation_measures, pd.DataFrame) else [],
            "latest": latest,
            "latest_by_period": latest_by_period,
            "recent_average": _average_recent(valuation_rows),
        },
        "financial_data": financial_data_clean,
    }

