from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
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


def _dict_for_symbol(payload: Any, symbol: str) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    candidate = payload.get(symbol) or payload
    return _json_safe(candidate if isinstance(candidate, dict) else {})


def _fetch_attr(obj: Any, name: str) -> Any:
    try:
        attr = getattr(obj, name)
        return attr() if callable(attr) else attr
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {str(exc)[:240]}"}


def _live_quote_payload(info: Any) -> Dict[str, Any]:
    if not isinstance(info, dict):
        return {}
    keys = (
        "symbol",
        "currency",
        "financialCurrency",
        "currentPrice",
        "regularMarketPrice",
        "sharesOutstanding",
        "impliedSharesOutstanding",
        "marketCap",
        "enterpriseValue",
    )
    return _json_safe({key: info.get(key) for key in keys if info.get(key) is not None})


def _company_profile_payload(profile: Any, symbol: str) -> Dict[str, Any]:
    clean = _dict_for_symbol(profile, symbol)
    return {
        "sector": str(clean.get("sector") or "").strip(),
        "industry": str(clean.get("industry") or "").strip(),
        "source": "yahooquery.asset_profile",
    }


def _fetch_live_quote(symbol: str) -> Dict[str, Any]:
    try:
        import yfinance as yf

        return _live_quote_payload(yf.Ticker(symbol).info)
    except Exception as exc:
        return {"error": f"{type(exc).__name__}: {str(exc)[:240]}"}


def _parse_date(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        dt = value.to_pydatetime()
    elif isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text or text.lower() in {"nan", "nat", "none"}:
            return None
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y", "%d/%m/%Y"):
            try:
                dt = datetime.strptime(text[:19], fmt)
                break
            except ValueError:
                dt = None
        if dt is None:
            try:
                dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except Exception:
                return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _first_event_date(row: Dict[str, Any]) -> Optional[datetime]:
    date_keys = (
        "eventDate",
        "date",
        "startDate",
        "endDate",
        "createdDate",
        "updatedDate",
        "pubDate",
    )
    for key in date_keys:
        dt = _parse_date(row.get(key))
        if dt is not None:
            return dt
    return None


def _filter_corporate_events(
    rows: List[Dict[str, Any]],
    *,
    report_date: datetime,
    months_back: int = 3,
) -> List[Dict[str, Any]]:
    cutoff = report_date - timedelta(days=30 * months_back)
    filtered: List[Dict[str, Any]] = []
    for row in rows:
        dt = _first_event_date(row)
        if dt is None:
            continue
        if dt >= cutoff:
            clean_row = dict(row)
            clean_row.setdefault("event_date", dt.date().isoformat())
            clean_row["timing"] = "future" if dt.date() > report_date.date() else "recent"
            filtered.append(clean_row)
    return sorted(
        filtered,
        key=lambda row: str(row.get("event_date") or row.get("date") or row.get("eventDate") or ""),
        reverse=True,
    )


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

    report_date = datetime.now(timezone.utc)
    try:
        ticker_obj = Ticker(symbol)
    except Exception as exc:
        return {
            "status": "error",
            "ticker": symbol,
            "error": f"yahooquery init failed: {type(exc).__name__}: {str(exc)[:240]}",
        }

    valuation_measures = _fetch_attr(ticker_obj, "valuation_measures")
    financial_data = _fetch_attr(ticker_obj, "financial_data")
    earning_history = _fetch_attr(ticker_obj, "earning_history")
    corporate_events = _fetch_attr(ticker_obj, "corporate_events")
    share_purchase_activity = _fetch_attr(ticker_obj, "share_purchase_activity")
    asset_profile = _fetch_attr(ticker_obj, "asset_profile")
    live_quote = _fetch_live_quote(symbol)

    valuation_rows = _df_records(valuation_measures)
    financial_data_clean = _dict_for_symbol(financial_data, symbol)
    earning_history_rows = _df_records(earning_history)
    corporate_event_rows = _df_records(corporate_events)
    recent_corporate_events = _filter_corporate_events(
        corporate_event_rows,
        report_date=report_date.replace(tzinfo=None),
    )
    share_purchase_clean = _dict_for_symbol(share_purchase_activity, symbol)
    latest_by_period = _latest_records(valuation_rows)
    latest = _latest_preferred(valuation_rows)

    return {
        "status": "success",
        "ticker": symbol,
        "generated_at": report_date.isoformat(),
        "report_date": report_date.date().isoformat(),
        "valuation_measures": {
            "rows": valuation_rows,
            "columns": list(valuation_measures.columns) if isinstance(valuation_measures, pd.DataFrame) else [],
            "latest": latest,
            "latest_by_period": latest_by_period,
            "recent_average": _average_recent(valuation_rows),
        },
        "live_quote": live_quote,
        "company_profile": _company_profile_payload(asset_profile, symbol),
        "financial_data": financial_data_clean,
        "earnings_surprise": {
            "rows": earning_history_rows,
            "columns": list(earning_history.columns) if isinstance(earning_history, pd.DataFrame) else [],
            "error": earning_history.get("error") if isinstance(earning_history, dict) else None,
        },
        "corporate_events": {
            "rows": recent_corporate_events,
            "all_rows_count": len(corporate_event_rows),
            "filtered_rows_count": len(recent_corporate_events),
            "filter": {
                "report_date": report_date.date().isoformat(),
                "past_months_included": 3,
                "future_events_included": True,
            },
            "error": corporate_events.get("error") if isinstance(corporate_events, dict) else None,
        },
        "share_purchase_activity": share_purchase_clean,
    }
