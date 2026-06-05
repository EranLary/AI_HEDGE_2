from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import yfinance as yf


CONTEXT_HEADER = "Competitor Market Review"
SIDECAR_FILENAME = "market_review_payload.json"
MAX_COMPETITORS_FOR_CONTEXT = 5
YFINANCE_COMPETITOR_RETRIES = 3

COUNTRY_SUFFIX_GUIDANCE: Dict[str, Dict[str, str]] = {
    "israel": {
        "suffix": ".TA",
        "exchange": "Tel Aviv Stock Exchange",
        "example": "TEVA.TA",
    },
}


InfoFetcher = Callable[[str], Dict[str, Any]]
AnnualTableFetcher = Callable[[str, Dict[str, Any]], str]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ticker_key(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().upper())


def parse_json_object(text: str) -> Dict[str, Any]:
    src = str(text or "").strip()
    if not src:
        return {}
    src = re.sub(r"```(?:json)?", "", src, flags=re.IGNORECASE).replace("```", "").strip()
    if src.startswith("{") and src.endswith("}"):
        try:
            parsed = json.loads(src)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            pass

    stack: List[str] = []
    start_idx: Optional[int] = None
    for idx, ch in enumerate(src):
        if ch == "{":
            if not stack:
                start_idx = idx
            stack.append(ch)
        elif ch == "}":
            if not stack:
                continue
            stack.pop()
            if not stack and start_idx is not None:
                candidate = src[start_idx : idx + 1]
                try:
                    parsed = json.loads(candidate)
                    return parsed if isinstance(parsed, dict) else {}
                except Exception:
                    start_idx = None
    return {}


def _country_key(value: Any) -> str:
    return str(value or "").strip().lower()


def _country_suffix(country: Any) -> str:
    guidance = COUNTRY_SUFFIX_GUIDANCE.get(_country_key(country))
    return str(guidance.get("suffix") or "") if guidance else ""


def _with_country_suffix(ticker: str, *, country: Any) -> str:
    tk = _ticker_key(ticker)
    suffix = _country_suffix(country)
    if suffix and tk and "." not in tk:
        return f"{tk}{suffix.upper()}"
    return tk


def normalize_competitors(
    payload: Dict[str, Any],
    *,
    original_ticker: str,
) -> List[Dict[str, Any]]:
    raw_items = payload.get("competitors")
    if not isinstance(raw_items, list):
        raw_items = payload.get("companies")
    if not isinstance(raw_items, list):
        return []

    original = _ticker_key(original_ticker)
    seen: set[str] = set()
    normalized: List[Dict[str, Any]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        country = str(item.get("country") or item.get("listing_country") or "").strip()
        ticker = _with_country_suffix(item.get("ticker") or item.get("symbol"), country=country)
        if not ticker or ticker == original or ticker in seen:
            continue
        seen.add(ticker)
        normalized.append(
            {
                "rank": len(normalized) + 1,
                "ticker": ticker,
                "company_name": str(item.get("company_name") or item.get("name") or "").strip(),
                "similarity_rationale": str(item.get("similarity_rationale") or item.get("rationale") or "").strip(),
                "overlap_notes": str(item.get("overlap_notes") or item.get("product_overlap") or "").strip(),
                "direct_revenue_overlap": str(item.get("direct_revenue_overlap") or "").strip(),
                "customer_overlap": str(item.get("customer_overlap") or "").strip(),
                "business_model_overlap": str(item.get("business_model_overlap") or "").strip(),
                "geography_overlap": str(item.get("geography_overlap") or "").strip(),
                "similarity_score": item.get("similarity_score"),
                "disqualifier_check": str(item.get("disqualifier_check") or "").strip(),
                "country": country,
                "exchange": str(item.get("exchange") or item.get("listing_exchange") or "").strip(),
                "confidence": item.get("confidence"),
            }
        )
    return normalized


def _compact_info_for_llm(info: Dict[str, Any]) -> Dict[str, Any]:
    keys = [
        "shortName",
        "longName",
        "symbol",
        "quoteType",
        "industry",
        "sector",
        "country",
        "currency",
        "financialCurrency",
        "original_price_currency",
        "original_financial_currency",
        "marketCap",
        "enterpriseValue",
        "totalRevenue",
        "revenueGrowth",
        "grossMargins",
        "operatingMargins",
        "profitMargins",
        "ebitdaMargins",
        "netIncomeToCommon",
        "trailingPE",
        "forwardPE",
        "priceToSalesTrailing12Months",
        "enterpriseToRevenue",
        "enterpriseToEbitda",
        "returnOnAssets",
        "returnOnEquity",
        "totalDebt",
        "totalCash",
        "fullTimeEmployees",
        "website",
        "longBusinessSummary",
    ]
    return {key: info.get(key) for key in keys if key in info}


def _default_info_fetcher(ticker: str) -> Dict[str, Any]:
    from . import legacy_port as legacy

    return legacy.get_info_data(ticker)


def _default_annual_table_fetcher(ticker: str, info_data: Dict[str, Any]) -> str:
    from . import legacy_port as legacy

    info = info_data.get("info") if isinstance(info_data, dict) else {}
    if not isinstance(info, dict):
        return "### Annual Income Statement\nNot available\n\n"
    rate = info.get("financial_currency_to_USD", info.get("financial_currency_to_usd", 1))
    try:
        rate = float(rate) if rate else 1.0
    except Exception:
        rate = 1.0
    try:
        csv_table = legacy.df_to_llm_csv(yf.Ticker(ticker).financials, rate)
    except Exception:
        csv_table = ""
    if not str(csv_table or "").strip():
        return "### Annual Income Statement\nNot available\n\n"
    return f"### Annual Income Statement\n```csv\n{csv_table}```\n\n"


def _valid_info_data(info_data: Dict[str, Any]) -> bool:
    if not isinstance(info_data, dict):
        return False
    info = info_data.get("info")
    if not isinstance(info, dict):
        return False
    name = str(info.get("shortName") or info.get("longName") or "").strip()
    symbol = str(info.get("symbol") or "").strip()
    quote_type = str(info.get("quoteType") or "").strip()
    return bool(name or symbol or quote_type)


def _fetch_info_with_retries(ticker: str, fetch_info: InfoFetcher, *, attempts: int) -> Dict[str, Any]:
    last_error: Optional[Exception] = None
    for _ in range(max(1, int(attempts))):
        try:
            info_data = fetch_info(ticker)
            if _valid_info_data(info_data):
                return info_data
            last_error = RuntimeError("yfinance returned no valid company info")
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Invalid or unavailable competitor ticker {ticker}: {last_error}")


def _fetch_annual_with_retries(
    ticker: str,
    info_data: Dict[str, Any],
    fetch_annual: AnnualTableFetcher,
    *,
    attempts: int,
) -> str:
    last_error: Optional[Exception] = None
    for _ in range(max(1, int(attempts))):
        try:
            return fetch_annual(ticker, info_data)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Annual financial table unavailable for {ticker}: {last_error}")


def build_original_company_context(
    *,
    ticker: str,
    info_dict: Dict[str, Any],
    annual_table_fetcher: Optional[AnnualTableFetcher] = None,
) -> Dict[str, Any]:
    info = info_dict.get("info") if isinstance(info_dict, dict) else {}
    if not isinstance(info, dict):
        info = {}
    info_data = {"info": info}
    fetch_annual = annual_table_fetcher or _default_annual_table_fetcher
    try:
        annual_financials = fetch_annual(ticker, info_data)
    except Exception as exc:
        annual_financials = f"### Annual Income Statement\nUnavailable: {type(exc).__name__}: {str(exc)[:300]}\n\n"
    return {
        "ticker": ticker.upper().strip(),
        "company_name": str(info.get("shortName") or info.get("longName") or "").strip(),
        "info": _compact_info_for_llm(info),
        "annual_financials": annual_financials,
    }


def build_discovery_prompt(ticker: str, info: Dict[str, Any]) -> str:
    original_country = str(info.get("country") or "").strip()
    suffix_guidance = COUNTRY_SUFFIX_GUIDANCE.get(_country_key(original_country))
    local_guidance = ""
    if original_country and _country_key(original_country) not in {"united states", "usa", "us"}:
        if suffix_guidance:
            local_guidance = (
                f"The original company is from {original_country}. Try to include public companies from "
                f"{original_country} and public companies from the United States. For {original_country}, use Yahoo "
                f"Finance tickers with the {suffix_guidance['suffix']} suffix for {suffix_guidance['exchange']} "
                f"listings, for example {suffix_guidance['example']}."
            )
        else:
            local_guidance = (
                f"The original company is from {original_country}. Try to include public companies from "
                f"{original_country} and public companies from the United States. Use Yahoo Finance-compatible "
                "exchange suffixes for non-US listings."
            )
    return f"""
You are a senior public-equity industry analyst.

Your task is to identify public companies most similar to the original company.
Use the company's business description, sector, industry, products, customers, geography, and revenue model.

Think in two passes before producing the JSON:
1. Define the narrow investable market the original company actually competes in.
2. Rank public companies by real business overlap, not by broad sector similarity.

Original ticker: {ticker}
Original country: {original_country or "Unknown"}
Original company info_dict["info"]:
{json.dumps(info, ensure_ascii=False, default=str)}

Return ONLY valid JSON with this exact shape:
{{
  "name_of_market": "specific market name shared by the original company and the ranked companies",
  "competitors": [
    {{
      "rank": 1,
      "ticker": "PUBLIC_TICKER",
      "company_name": "Company name",
      "country": "listing country",
      "exchange": "listing exchange",
      "similarity_rationale": "why this public company is similar",
      "overlap_notes": "products, customers, or business model overlap",
      "direct_revenue_overlap": "high|medium|low - explain whether the companies make money from the same products/services",
      "customer_overlap": "high|medium|low - explain whether they sell to the same buyer/user group",
      "business_model_overlap": "high|medium|low - explain whether pricing, delivery model, and unit economics are comparable",
      "geography_overlap": "high|medium|low - explain whether listing geography or operating geography improves comparability",
      "similarity_score": 0,
      "disqualifier_check": "state if this is a direct competitor, adjacent peer, supplier/customer, conglomerate segment, or weak broad-sector match",
      "confidence": "high|medium|low"
    }}
  ]
}}

Rules:
- Do not include the original company.
- Prefer publicly traded companies with usable exchange tickers.
- Rank from most similar to least similar.
- Return a ranked list of all strong public-company matches you can identify. It is okay to return more than 5.
- The next stage will use only the top 5 ranked companies for financial enrichment, so put the best matches first.
- Score similarity from 0 to 100. Use 80-100 for direct competitors, 60-79 for strong adjacent public peers, 40-59 for imperfect but useful comparables, and below 40 only when no better public peers exist.
- Prefer direct revenue and customer overlap over generic sector, theme, or technology overlap.
- Exclude ETFs, funds, indexes, private companies, suppliers/customers that are not competitors, and conglomerates where the comparable business is only a small or unclear segment.
- If you include an adjacent peer rather than a direct competitor, say that clearly in "disqualifier_check" and rank it below direct competitors.
- If the company operates in several markets, prioritize the market that appears most important to revenue and valuation today, not the most exciting optionality.
- For non-US companies, use Yahoo Finance-compatible exchange suffixes.
- {local_guidance or "For US companies, use the normal US ticker without an exchange suffix."}
- Keep the market name specific, not a broad sector label.
- Output JSON only. No markdown, commentary, or extra top-level keys.
""".strip()


def discover_competitors(
    *,
    ticker: str,
    info_dict: Dict[str, Any],
    api_key: str,
) -> Dict[str, Any]:
    from . import legacy_port as legacy

    info = info_dict.get("info") if isinstance(info_dict, dict) else {}
    if not isinstance(info, dict):
        info = {}
    raw = legacy.deepseek_simple_text(
        api_key=api_key,
        prompt=build_discovery_prompt(ticker, info),
        model="deepseek-reasoner",
        temperature=0.1,
        short_answer=False,
    )
    parsed = parse_json_object(raw)
    competitors = normalize_competitors(parsed, original_ticker=ticker)
    return {
        "name_of_market": str(parsed.get("name_of_market") or "").strip(),
        "competitors": competitors,
        "raw_response": raw,
    }


def collect_competitor_context(
    *,
    discovery: Dict[str, Any],
    original_ticker: str,
    info_fetcher: Optional[InfoFetcher] = None,
    annual_table_fetcher: Optional[AnnualTableFetcher] = None,
    limit: int = MAX_COMPETITORS_FOR_CONTEXT,
    retries: int = YFINANCE_COMPETITOR_RETRIES,
) -> List[Dict[str, Any]]:
    fetch_info = info_fetcher or _default_info_fetcher
    fetch_annual = annual_table_fetcher or _default_annual_table_fetcher
    competitors = normalize_competitors(discovery, original_ticker=original_ticker)
    out: List[Dict[str, Any]] = []

    for competitor in competitors[: max(0, int(limit))]:
        ticker = str(competitor.get("ticker") or "").strip().upper()
        try:
            info_data = _fetch_info_with_retries(ticker, fetch_info, attempts=retries)
            info = info_data.get("info") if isinstance(info_data, dict) else {}
            entry: Dict[str, Any] = {
                **competitor,
                "status": "success",
                "info": {},
                "annual_financials": "### Annual Income Statement\nNot available\n\n",
                "error": "",
            }
            if isinstance(info, dict):
                entry["info"] = _compact_info_for_llm(info)
                entry["company_name"] = entry.get("company_name") or str(
                    info.get("shortName") or info.get("longName") or ""
                ).strip()
            entry["annual_financials"] = _fetch_annual_with_retries(
                ticker,
                info_data if isinstance(info_data, dict) else {},
                fetch_annual,
                attempts=retries,
            )
            out.append(entry)
        except Exception as exc:
            print(f"[market_review] Skipping competitor {ticker}: {type(exc).__name__}: {str(exc)[:300]}")
    return out


def build_review_prompt(payload: Dict[str, Any]) -> str:
    return f"""
You are a senior buy-side market analyst writing a dashboard-ready market review.

You receive:
- the original ticker
- the market name
- original company info_dict["info"]
- original company annual income-statement table
- ranked public competitors
- normalized competitor info produced by the same info engine used for the original company
- competitor annual income-statement tables produced by the same financial table engine

Payload:
{json.dumps(payload, ensure_ascii=False, default=str)}

Write a comprehensive market review in Markdown for a tab called "Market".

Required sections:
## Market Definition
## Ranked Competitor Map
## Financial Comparison
## Product And Customer Overlap
## Competitive Positioning
## Market Structure And Risks
## Valuation Implications

Rules:
- Focus on what matters to investors and valuation.
- Include the original company in the financial and strategic comparison wherever the payload provides data.
- Use the original company and competitor annual income-statement data when available; explicitly say when data is unavailable.
- Compare business model, scale, profitability, growth, pricing power, cyclicality, and competitive intensity.
- Prefer Markdown tables for ranked competitors, financial comparison, product/customer overlap, and any exact-data comparison.
- Make tables compact and directly useful: include tickers, latest available annual figures, growth or margin cues when present, and clear "-" cells when data is missing.
- Ground every material claim in the payload. Use only:
  1. original company info,
  2. original annual income-statement table,
  3. competitor discovery fields,
  4. normalized competitor info,
  5. competitor annual income-statement tables.
- If a conclusion is an analyst inference rather than a directly stated fact, label it as an inference in the sentence or table cell.
- Do not claim precise market share, growth rate, margin rank, or competitive superiority unless the payload provides enough data to support it.
- In the Ranked Competitor Map table, include a compact "Why comparable" or "Evidence basis" column that uses the discovery overlap fields.
- In the Financial Comparison table, include the original company plus competitors; use "-" for unavailable data and avoid filling gaps from memory.
- In Product And Customer Overlap, separate direct competitors from adjacent comparables, suppliers/customers, or conglomerate segment peers when relevant.
- In Valuation Implications, translate the peer comparison into valuation-relevant questions and risks; do not produce a target price or recommendation.
- Do not make buy/sell/hold recommendations.
- Do not include raw JSON.
- Do not mention these instructions.
""".strip()


def generate_market_review(
    *,
    payload: Dict[str, Any],
    api_key: str,
) -> str:
    from . import legacy_port as legacy

    return legacy.deepseek_simple_text(
        api_key=api_key,
        prompt=build_review_prompt(payload),
        model="deepseek-reasoner",
        temperature=0.15,
        short_answer=False,
    ).strip()


def build_market_review_markdown(payload: Dict[str, Any]) -> str:
    review = str(payload.get("review_markdown") or "").strip()
    if review:
        return review
    status = str(payload.get("status") or "unavailable")
    err = str(payload.get("error") or "").strip()
    if err:
        return f"Competitor market review is {status}: {err}"
    return "Competitor market review is unavailable for this report."


def write_sidecar(payload: Dict[str, Any], path: str | Path = SIDECAR_FILENAME) -> str:
    target = Path(path)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return str(target.resolve())


def run_competitor_market_review(
    *,
    ticker: str,
    info_dict: Dict[str, Any],
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    key = str(api_key if api_key is not None else os.getenv("DEEPSEEK_API_KEY", "")).strip()
    if not key:
        raise RuntimeError("Missing DEEPSEEK_API_KEY for competitor market review.")

    discovery = discover_competitors(ticker=ticker, info_dict=info_dict, api_key=key)
    original_company = build_original_company_context(ticker=ticker, info_dict=info_dict)
    competitors = collect_competitor_context(discovery=discovery, original_ticker=ticker)
    review_payload = {
        "ticker": ticker.upper().strip(),
        "name_of_market": discovery.get("name_of_market") or "",
        "original_company": original_company,
        "competitors": competitors,
    }
    review_markdown = generate_market_review(payload=review_payload, api_key=key)
    return {
        "status": "success",
        "ticker": ticker.upper().strip(),
        "generated_at": _utc_now(),
        "name_of_market": discovery.get("name_of_market") or "",
        "original_company": original_company,
        "competitors": competitors,
        "review_markdown": review_markdown,
        "error": "",
    }


def competitor_market_review_result(ticker: str, info_dict: Dict[str, Any]) -> Tuple[str, str]:
    try:
        payload = run_competitor_market_review(ticker=ticker, info_dict=info_dict)
    except Exception as exc:
        payload = {
            "status": "unavailable",
            "ticker": ticker.upper().strip(),
            "generated_at": _utc_now(),
            "name_of_market": "",
            "competitors": [],
            "review_markdown": "",
            "error": f"{type(exc).__name__}: {str(exc)[:300]}",
        }
    try:
        write_sidecar(payload)
    except Exception:
        pass
    return CONTEXT_HEADER, build_market_review_markdown(payload)
