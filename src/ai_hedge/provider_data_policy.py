from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Mapping


# Provider company-info dictionaries mix durable profile fields, live market
# fields, and opaque financial calculations. Only explicitly approved fields
# may cross an LLM boundary.
SAFE_COMPANY_PROFILE_KEYS = (
    "shortName",
    "longName",
    "displayName",
    "symbol",
    "underlyingSymbol",
    "quoteType",
    "exchange",
    "fullExchangeName",
    "industry",
    "sector",
    "country",
    "state",
    "city",
    "address1",
    "website",
    "longBusinessSummary",
    "fullTimeEmployees",
    "currency",
    "financialCurrency",
    "original_price_currency",
    "original_financial_currency",
)

SAFE_MARKET_CONTEXT_KEYS = (
    "currentPrice",
    "regularMarketPrice",
    "marketCap",
    "sharesOutstanding",
    "impliedSharesOutstanding",
)

# Multiples remain useful for like-for-like valuation comparisons. They are
# intentionally isolated from operating claims such as growth and margins.
SAFE_VALUATION_CONTEXT_KEYS = (
    "trailingPE",
    "forwardPE",
    "pegRatio",
    "priceToBook",
    "priceToSalesTrailing12Months",
    "enterpriseToRevenue",
    "enterpriseToEbitda",
)

SAFE_LIVE_QUOTE_KEYS = (
    "currentPrice",
    "regularMarketPrice",
    "marketCap",
    "enterpriseValue",
    "sharesOutstanding",
    "impliedSharesOutstanding",
    "currency",
    "financialCurrency",
)

SAFE_VALUATION_MEASURE_KEYS = (
    "asOfDate",
    "periodType",
    "MarketCap",
    "EnterpriseValue",
    "PeRatio",
    "ForwardPeRatio",
    "PegRatio",
    "PbRatio",
    "PsRatio",
    "EnterprisesValueRevenueRatio",
    "EnterprisesValueEBITDARatio",
)

# Kept as an explicit policy list for tests, reviews, and future provider
# additions. The allowlists above remain the enforcement mechanism.
QUARANTINED_FINANCIAL_INFO_KEYS = frozenset(
    {
        "totalRevenue",
        "revenueGrowth",
        "grossProfits",
        "ebitda",
        "netIncomeToCommon",
        "totalCash",
        "totalDebt",
        "freeCashflow",
        "operatingCashflow",
        "earningsGrowth",
        "earningsQuarterlyGrowth",
        "grossMargins",
        "operatingMargins",
        "ebitdaMargins",
        "profitMargins",
        "returnOnEquity",
        "returnOnAssets",
        "trailingEps",
        "forwardEps",
        "bookValue",
        "currentRatio",
        "quickRatio",
        "debtToEquity",
    }
)


def _select(source: Mapping[str, Any], keys: tuple[str, ...]) -> Dict[str, Any]:
    return {key: deepcopy(source[key]) for key in keys if key in source}


def safe_company_profile(
    info: Mapping[str, Any] | None,
    *,
    include_market_context: bool = False,
    include_valuation_context: bool = False,
) -> Dict[str, Any]:
    """Return an allowlisted company profile safe to serialize into prompts."""

    if not isinstance(info, Mapping):
        return {}
    keys = list(SAFE_COMPANY_PROFILE_KEYS)
    if include_market_context:
        keys.extend(SAFE_MARKET_CONTEXT_KEYS)
    if include_valuation_context:
        keys.extend(SAFE_VALUATION_CONTEXT_KEYS)
    return _select(info, tuple(dict.fromkeys(keys)))


def valuation_only_yahooquery(snapshot: Mapping[str, Any] | None) -> Dict[str, Any]:
    """Keep Yahooquery valuation rows and safe quote metadata, never financial_data."""

    if not isinstance(snapshot, Mapping):
        return {}

    result = _select(
        snapshot,
        ("status", "ticker", "generated_at", "report_date", "error"),
    )
    valuation = snapshot.get("valuation_measures")
    if isinstance(valuation, Mapping):
        clean_valuation: Dict[str, Any] = {}
        rows = valuation.get("rows")
        if isinstance(rows, list):
            clean_valuation["rows"] = [
                _select(row, SAFE_VALUATION_MEASURE_KEYS)
                for row in rows
                if isinstance(row, Mapping)
            ]
        columns = valuation.get("columns")
        if isinstance(columns, list):
            clean_valuation["columns"] = [
                key for key in SAFE_VALUATION_MEASURE_KEYS if key in columns
            ]
        latest = valuation.get("latest")
        if isinstance(latest, Mapping):
            clean_valuation["latest"] = _select(latest, SAFE_VALUATION_MEASURE_KEYS)
        latest_by_period = valuation.get("latest_by_period")
        if isinstance(latest_by_period, Mapping):
            clean_valuation["latest_by_period"] = {
                str(period): _select(row, SAFE_VALUATION_MEASURE_KEYS)
                for period, row in latest_by_period.items()
                if isinstance(row, Mapping)
            }
        recent_average = valuation.get("recent_average")
        if isinstance(recent_average, Mapping):
            clean_valuation["recent_average"] = _select(
                recent_average,
                SAFE_VALUATION_MEASURE_KEYS,
            )
        result["valuation_measures"] = clean_valuation

    live_quote = snapshot.get("live_quote")
    if isinstance(live_quote, Mapping):
        result["live_quote"] = _select(live_quote, SAFE_LIVE_QUOTE_KEYS)
    return result
