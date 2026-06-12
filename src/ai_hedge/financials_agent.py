from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import yfinance as yf


REQUIRED_METRICS = [
    "Revenue",
    "Sales Growth",
    "Gross Profit",
    "Gross Margin",
    "Operating Income",
    "Operating Margin",
    "Net Income (GAAP)",
    "Net Margin",
    "Tax Rate",
    "Operating Cash Flow",
    "Capital Expenditures (Capex)",
    "Capex / Revenue",
    "Free Cash Flow (FCF)",
    "FCF / Net Income",
    "(+) Stock-Based Compensation (SBC)",
    "SBC / Revenue",
    "(+) Amortization of Intangible Assets",
    "(+/-) One-Time Expenses/Income, Net",
    "(+/-) Additional Adjustments, if any",
    "Estimated Net Income (Non-GAAP)",
    "Total Assets",
    "Customers / Accounts Receivable",
    "Inventory",
    "Liquid Assets: Cash, Cash Equivalents, and Short-Term Investments",
    "Total Liabilities",
    "Total Shareholders' Equity",
    "Total Debt: Short-Term and Long-Term",
    "Net Liquidity: Liquid Assets Less Debt",
    "Equity-to-Assets Ratio",
]

MARKET_SNAPSHOT_METRICS = [
    "Market Capitalization",
    "Enterprise Value (EV)",
    "Price-to-Book Ratio (P/B)",
    "Price-to-Earnings Ratio (P/E)",
]


def _safe_json_dict(text: str) -> Dict[str, Any]:
    src = str(text or "").strip()
    if not src:
        return {}
    src = re.sub(r"```(?:json)?", "", src, flags=re.IGNORECASE).strip()
    if src.startswith("{") and src.endswith("}"):
        try:
            parsed = json.loads(src)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            pass
    match = re.search(r"\{.*\}", src, re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if np.isfinite(value) else None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        n = float(value)
        return n if np.isfinite(n) else None
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.date().isoformat()
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return str(value)


def _df_to_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    tmp = df.copy()
    if isinstance(tmp.columns, pd.MultiIndex):
        tmp.columns = [" | ".join(str(part) for part in col if str(part)) for col in tmp.columns]
    tmp = tmp.dropna(axis=0, how="all").dropna(axis=1, how="all")
    if tmp.empty:
        return []
    tmp = tmp.T
    tmp.index.name = "period"
    tmp = tmp.reset_index()
    return [_json_safe(row) for row in tmp.to_dict(orient="records")]


def _table_payload(df: pd.DataFrame, label: str, statement_type: str, period_type: str) -> Dict[str, Any]:
    return {
        "label": label,
        "statement_type": statement_type,
        "period_type": period_type,
        "rows": _df_to_records(df),
    }


def build_raw_financials_payload(ticker: str, info_dict: Dict[str, Any]) -> Dict[str, Any]:
    info = info_dict.get("info", {}) if isinstance(info_dict, dict) else {}
    info = info if isinstance(info, dict) else {}
    ticker_obj = yf.Ticker(ticker)
    financial_currency = (
        info.get("original_financial_currency")
        or info.get("financialCurrency")
        or info.get("financial_currency")
        or "USD"
    )
    original_ticker = (
        info.get("symbol")
        or info.get("underlyingSymbol")
        or info.get("quoteType")
        or ticker
    )
    raw_info = {
        "ticker": ticker,
        "original_ticker": str(original_ticker),
        "company_name": info.get("shortName") or info.get("longName") or ticker,
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "business_summary": info.get("longBusinessSummary"),
        "financial_currency": financial_currency,
        "original_price_currency": info.get("original_price_currency") or info.get("currency"),
        "financial_currency_to_USD": info.get("financial_currency_to_USD") or info.get("financial_currency_to_usd"),
        "current_price": info.get("currentPrice") or info.get("regularMarketPrice"),
        "shares_outstanding": info.get("sharesOutstanding") or info.get("impliedSharesOutstanding"),
        "market_cap": info.get("marketCap"),
        "enterprise_value": info.get("enterpriseValue"),
        "price_to_book": info.get("priceToBook"),
        "total_debt": info.get("totalDebt"),
        "total_cash": info.get("totalCash"),
    }
    return {
        "ticker": str(ticker).upper(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "currency": str(financial_currency or "USD").upper(),
        "info": _json_safe(raw_info),
        "statements": [
            _table_payload(ticker_obj.financials, "Annual Income Statement", "income_statement", "annual"),
            _table_payload(ticker_obj.quarterly_financials, "Quarterly Income Statement", "income_statement", "quarterly"),
            _table_payload(ticker_obj.balance_sheet, "Annual Balance Sheet", "balance_sheet", "annual"),
            _table_payload(ticker_obj.quarterly_balance_sheet, "Quarterly Balance Sheet", "balance_sheet", "quarterly"),
            _table_payload(ticker_obj.cashflow, "Annual Cash Flow Statement", "cash_flow", "annual"),
            _table_payload(ticker_obj.quarterly_cashflow, "Quarterly Cash Flow Statement", "cash_flow", "quarterly"),
        ],
    }


def build_financials_prompt(ticker: str, payload: Dict[str, Any]) -> str:
    required = "\n".join(f"- {metric}" for metric in REQUIRED_METRICS)
    snapshot = "\n".join(f"- {metric}" for metric in MARKET_SNAPSHOT_METRICS)
    return f"""
You are a forensic financial statement analyst building a dashboard table for equity research.

Goal:
Create one clear, investor-friendly financials table for {ticker}. The table must combine annual and quarterly financial statements in the company's ORIGINAL financial reporting currency. Do not convert to USD. Use the financial currency provided in the payload.

Use Deep Reasoning:
- Understand the business model from the ticker/company info before choosing optional rows.
- Use income statement, balance sheet, and cash flow statement together.
- Prefer reported statement line items over inference.
- EXTREMELY IMPORTANT: do not hallucinate, invent, smooth, backfill, interpolate, or "make reasonable" numbers. Every numeric value must come directly from the provided statements/quote info or from a clearly stated formula using provided numbers.
- If a real number is not available, output null. A null with a useful note is better than a fake number.
- Never use industry averages, outside memory, estimates, assumptions, or generic financial knowledge to fill a table cell.
- If an exact line is missing, derive only when defensible from nearby lines and mark confidence as "derived".
- If unavailable, use null and explain the limitation in the row note. Do not hallucinate.
- Sort columns chronologically from oldest to newest, mixing annual and quarterly periods intelligently by period end date. Preserve whether each period is annual or quarterly in column metadata. If a fiscal year and its Q4 share the same period-end date, put Q4 before FY.
- Keep values in the original financial currency. Ratios and margins should be decimals, not strings.
- Keep currency/count numeric values as raw statement values. Do not rescale to thousands, millions, or billions; the dashboard will handle display formatting.
- Make the table simple enough for a dashboard but deep enough to explain the economics.

Mandatory rows, in this exact order:
{required}

Current market snapshot fields, outside the period table:
{snapshot}

Optional rows:
- You may add up to 7 additional rows only if truly important for this company type.
- Examples: ARR/RPO for SaaS, deposits/NII for banks, same-store sales for retailers, inventory turns, R&D intensity, deferred revenue, net debt, customer deposits, asset turnover.
- Do not add optional rows just to look comprehensive.

Non-GAAP logic:
- Estimated Net Income (Non-GAAP) should start from Net Income (GAAP), add back SBC, amortization of intangibles, one-time expenses/income net, and additional adjustments when supported by the statements or clearly inferable.
- Put adjustments in the relevant adjustment rows with notes.
- If the data is insufficient, keep the estimate close to GAAP and explain why.

Balance sheet and market-value logic:
- Total Assets, receivables, inventory, liquid assets, liabilities, equity, debt, and net liquidity should come from the balance sheet whenever available.
- Liquid Assets means cash + cash equivalents + short-term investments / marketable securities. If yfinance reports only cash and equivalents, use that and say so in the note.
- Total Debt means short-term debt plus long-term debt. If only total debt is available from quote info, use it only where period-specific statement debt is missing and mark the row "derived" or "mixed".
- Net Liquidity = Liquid Assets - Total Debt.
- Equity-to-Assets Ratio = Total Shareholders' Equity / Total Assets. It is a ratio decimal, not a percent string.
- Tax Rate = tax provision / pretax income when both are available. If either line is missing, use null.
- Capital Expenditures (Capex) should come from the cash flow statement when available. Use the absolute cash outflow amount as a positive currency value even if the statement reports capex as negative.
- Capex / Revenue = Capital Expenditures (Capex) / Revenue when both are available. It is a ratio decimal, not a percent string.
- SBC / Revenue = Stock-Based Compensation / Revenue when both are available. If SBC is not disclosed separately, use null.
- Market Capitalization, Enterprise Value (EV), Price-to-Book Ratio (P/B), and Price-to-Earnings Ratio (P/E) are current quote snapshot fields, not period-table rows. Put them in current_metrics only when available from quote info or defensible from quote info plus latest statements. Do not invent historical values for them.

Return ONLY valid JSON with this exact shape:
{{
  "ticker": "string",
  "currency": "string",
  "unit": "raw",
  "title": "string",
  "subtitle": "string",
  "periods": [
    {{
      "key": "YYYY-MM-DD_A or YYYY-MM-DD_Q",
      "label": "FY 2025 or Q3 2025",
      "date": "YYYY-MM-DD",
      "period_type": "annual | quarterly"
    }}
  ],
  "rows": [
    {{
      "metric": "Revenue",
      "kind": "currency | percent | ratio | count",
      "values": {{"period_key": 0}},
      "quality": "reported | derived | unavailable | mixed",
      "note": "short plain-English note"
    }}
  ],
  "current_metrics": [
    {{
      "metric": "Market Capitalization",
      "kind": "currency | ratio",
      "value": null,
      "quality": "reported | derived | unavailable | mixed",
      "note": "short plain-English note"
    }}
  ],
  "added_rows": ["metric names you added beyond mandatory rows"],
  "key_takeaways": ["5-10 concise bullets sorted from most important to least important"],
  "warnings": ["short caveats, missing-data notes, or comparability warnings"]
}}

Dashboard writing style:
- Short labels, not academic.
- Notes should help a user understand what the row means.
- Avoid long prose inside table cells.
- Use null for missing values.
- Use null for any number you cannot trace to the payload or to a transparent formula from payload numbers.
- Do not invent placeholder numbers to make the table look complete.
- Never output 0 for missing, unavailable, undisclosed, or not separately disclosed data. Output null instead. Only output 0 when the source statement actually reports zero or a formula from available values truly equals zero.
- Key takeaways should be simple, smart, and useful for a user who wants to understand the table fast: what changed, what looks strong or weak, what is one-off, and what deserves attention.
- Do not include markdown.

Financial statement payload JSON:
{json.dumps(payload, ensure_ascii=False)}
""".strip()


def _as_list(value: Any, limit: int = 12) -> List[Any]:
    if not isinstance(value, list):
        return []
    return value[:limit]


def _default_kind_for_metric(metric: str) -> str:
    text = str(metric or "").lower()
    if "margin" in text or "growth" in text or "equity-to-assets" in text:
        return "percent"
    if "tax rate" in text or "sbc / revenue" in text or "capex / revenue" in text:
        return "percent"
    if "ratio" in text or "p/b" in text or "fcf / net income" in text:
        return "ratio"
    return "currency"


def _metric_key(metric: str) -> str:
    return re.sub(r"\s+", " ", str(metric or "").replace("’", "'").replace("`", "'").strip().lower())


def _normalize_quality(value: Any) -> str:
    quality = str(value or "mixed").strip().lower()
    return quality if quality in {"reported", "derived", "unavailable", "mixed"} else "mixed"


def _coerce_number(value: Any) -> Optional[float]:
    try:
        num = float(value)
        return num if np.isfinite(num) else None
    except Exception:
        return None


def _snapshot_value_from_rows(rows: List[Any], metric: str) -> Optional[float]:
    for row in rows:
        if not isinstance(row, dict) or _metric_key(row.get("metric", "")) != _metric_key(metric):
            continue
        values = row.get("values") if isinstance(row.get("values"), dict) else {}
        for value in reversed(list(values.values())):
            num = _coerce_number(value)
            if num is not None and abs(num) > 1e-12:
                return num
    return None


def normalize_financials_analysis(raw: Dict[str, Any], *, ticker: str, currency: str) -> Dict[str, Any]:
    analysis = dict(raw) if isinstance(raw, dict) else {}
    periods = []
    seen = set()
    for period in _as_list(analysis.get("periods"), limit=40):
        if not isinstance(period, dict):
            continue
        key = str(period.get("key") or "").strip()
        date = str(period.get("date") or "").strip()
        period_type = str(period.get("period_type") or "").strip().lower()
        if not key and date:
            key = f"{date}_{'A' if period_type == 'annual' else 'Q'}"
        if not key or key in seen:
            continue
        seen.add(key)
        periods.append({
            "key": key,
            "label": str(period.get("label") or key).strip(),
            "date": date,
            "period_type": "annual" if period_type == "annual" else "quarterly",
        })
    periods.sort(key=lambda p: (p.get("date") or "", 0 if p.get("period_type") == "quarterly" else 1))

    period_keys = {p["key"] for p in periods}
    rows = []
    raw_rows = _as_list(analysis.get("rows"), limit=len(REQUIRED_METRICS) + len(MARKET_SNAPSHOT_METRICS) + 7)
    market_keys = {_metric_key(metric) for metric in MARKET_SNAPSHOT_METRICS}
    for row in raw_rows:
        if not isinstance(row, dict):
            continue
        metric = str(row.get("metric") or "").strip()
        if not metric:
            continue
        if _metric_key(metric) in market_keys:
            continue
        values_src = row.get("values") if isinstance(row.get("values"), dict) else {}
        values: Dict[str, Optional[float]] = {}
        quality = _normalize_quality(row.get("quality"))
        for key in period_keys:
            num = _coerce_number(values_src.get(key))
            values[key] = None if quality == "unavailable" and num == 0 else num
        rows.append({
            "metric": metric,
            "kind": str(row.get("kind") or "currency").strip().lower(),
            "values": values,
            "quality": quality,
            "note": str(row.get("note") or "").strip(),
        })

    ordered_rows: List[Dict[str, Any]] = []
    required_by_key = {_metric_key(metric): metric for metric in REQUIRED_METRICS}
    by_metric = {}
    for row in rows:
        raw_metric = str(row.get("metric") or "")
        canonical = required_by_key.get(_metric_key(raw_metric), raw_metric)
        row["metric"] = canonical
        by_metric[canonical] = row
    for metric in REQUIRED_METRICS:
        ordered_rows.append(by_metric.pop(metric, {
            "metric": metric,
            "kind": _default_kind_for_metric(metric),
            "values": {key: None for key in period_keys},
            "quality": "unavailable",
            "note": "Not available in the provided statements.",
        }))
    ordered_rows.extend(list(by_metric.values())[:7])

    current_by_key: Dict[str, Dict[str, Any]] = {}
    for item in _as_list(analysis.get("current_metrics"), limit=12):
        if not isinstance(item, dict):
            continue
        metric = str(item.get("metric") or "").strip()
        if not metric:
            continue
        quality = _normalize_quality(item.get("quality"))
        value = _coerce_number(item.get("value"))
        current_by_key[_metric_key(metric)] = {
            "metric": metric,
            "kind": str(item.get("kind") or _default_kind_for_metric(metric)).strip().lower(),
            "value": None if quality == "unavailable" and value == 0 else value,
            "quality": quality,
            "note": str(item.get("note") or "").strip(),
        }

    current_metrics = []
    for metric in MARKET_SNAPSHOT_METRICS:
        existing = current_by_key.get(_metric_key(metric))
        if existing:
            existing["metric"] = metric
            current_metrics.append(existing)
            continue
        fallback_value = _snapshot_value_from_rows(raw_rows, metric)
        current_metrics.append({
            "metric": metric,
            "kind": _default_kind_for_metric(metric),
            "value": fallback_value,
            "quality": "mixed" if fallback_value is not None else "unavailable",
            "note": "Current quote snapshot; not a historical period-table value." if fallback_value is not None else "Not available in the provided quote data.",
        })

    return {
        "ticker": str(analysis.get("ticker") or ticker).upper(),
        "currency": str(analysis.get("currency") or currency or "USD").upper(),
        "unit": "raw",
        "title": str(analysis.get("title") or "Financials").strip(),
        "subtitle": str(analysis.get("subtitle") or "Original reporting currency").strip(),
        "periods": periods,
        "rows": ordered_rows,
        "current_metrics": current_metrics,
        "added_rows": [str(x).strip() for x in _as_list(analysis.get("added_rows"), limit=7) if str(x).strip()],
        "key_takeaways": [str(x).strip() for x in _as_list(analysis.get("key_takeaways"), limit=10) if str(x).strip()],
        "warnings": [str(x).strip() for x in _as_list(analysis.get("warnings"), limit=8) if str(x).strip()],
    }


def financials_analysis_to_markdown(analysis: Dict[str, Any]) -> str:
    if not isinstance(analysis, dict) or not analysis:
        return "## Financials\n\nFinancials table is not available for this run.\n"
    periods = analysis.get("periods") if isinstance(analysis.get("periods"), list) else []
    rows = analysis.get("rows") if isinstance(analysis.get("rows"), list) else []
    lines = ["## Financials"]
    currency = str(analysis.get("currency") or "USD").upper()
    unit = str(analysis.get("unit") or "raw")
    lines.append(f"- Currency: {currency}")
    lines.append(f"- Unit: {unit}")
    if analysis.get("subtitle"):
        lines.append(f"- Context: {analysis.get('subtitle')}")
    lines.append("")
    takeaways = analysis.get("key_takeaways") if isinstance(analysis.get("key_takeaways"), list) else []
    if takeaways:
        lines.append("### Key Takeaways")
        for item in takeaways[:10]:
            lines.append(f"- {item}")
        lines.append("")
    if periods and rows:
        headers = ["Metric"] + [str(p.get("label") or p.get("key")) for p in periods] + ["Note"]
        lines.append("| " + " | ".join(headers) + " |")
        lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for row in rows:
            if not isinstance(row, dict):
                continue
            values = row.get("values") if isinstance(row.get("values"), dict) else {}
            cells = [str(row.get("metric") or "")]
            for period in periods:
                key = str(period.get("key") or "")
                value = values.get(key)
                if value is None:
                    cells.append("-")
                elif str(row.get("kind") or "").lower() == "percent":
                    cells.append(f"{float(value) * 100:.1f}%")
                elif str(row.get("kind") or "").lower() == "ratio":
                    cells.append(f"{float(value):.2f}")
                else:
                    cells.append(f"{float(value):,.0f}")
            cells.append(str(row.get("note") or ""))
            safe_cells = [c.replace("|", "\\|") for c in cells]
            lines.append("| " + " | ".join(safe_cells) + " |")
        lines.append("")
    warnings = analysis.get("warnings") if isinstance(analysis.get("warnings"), list) else []
    if warnings:
        lines.append("### Warnings")
        for item in warnings[:8]:
            lines.append(f"- {item}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def run_full_analysis(
    ticker: str,
    *,
    info_dict: Dict[str, Any],
    api_key: str,
    model: str = "deepseek-reasoner",
    temperature: float = 0.1,
) -> Dict[str, Any]:
    if not api_key:
        raise RuntimeError("Missing DEEPSEEK_API_KEY for financials agent.")
    payload = build_raw_financials_payload(ticker, info_dict)
    from . import legacy_port as legacy

    prompt = build_financials_prompt(ticker, payload)
    raw_response = legacy.deepseek_simple_text(
        api_key=api_key,
        prompt=prompt,
        model=model,
        temperature=temperature,
        short_answer=False,
    )
    parsed = _safe_json_dict(raw_response)
    if not parsed:
        raise RuntimeError("Financials agent response was not valid JSON.")
    analysis = normalize_financials_analysis(
        parsed,
        ticker=ticker,
        currency=str(payload.get("currency") or "USD"),
    )
    return {
        "ticker": ticker.upper(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "temperature": float(temperature),
        "llm_payload": payload,
        "analysis": analysis,
        "raw_response": raw_response,
    }
