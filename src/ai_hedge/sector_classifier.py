from __future__ import annotations

import os
import re
from typing import Any, Callable, Mapping

from .company_profile import resolve_company_profile
from .sector_weighted_valuation import SECTOR_WEIGHTS, canonical_sector


def _section_excerpt(text: str, heading: str, *, max_chars: int = 1800) -> str:
    source = str(text or "")
    match = re.search(
        rf"(?ims)^\s*#+\s*{re.escape(heading)}\s*$\s*(.*?)(?=^\s*#+\s+|\Z)",
        source,
    )
    return " ".join((match.group(1) if match else "").split())[:max_chars]


def classification_context(analysis_text: str) -> dict[str, str]:
    return {
        "what_the_company_is_doing": _section_excerpt(analysis_text, "What the company is doing"),
        "market_definition": _section_excerpt(analysis_text, "Market Definition"),
    }


def classify_sector(
    *,
    ticker: str,
    company_name: str,
    analysis_text: str,
    call_llm: Callable[[str], str],
) -> str | None:
    context = classification_context(analysis_text)
    allowed = " | ".join(SECTOR_WEIGHTS)
    base_prompt = f"""Classify this company into exactly one Yahoo Finance sector.
Return only one exact value from this closed list:
{allowed}

Ticker: {ticker}
Company name: {company_name}
What the company is doing: {context['what_the_company_is_doing']}
Market Definition: {context['market_definition']}"""
    first = canonical_sector(call_llm(base_prompt))
    if first:
        return first
    retry_prompt = base_prompt + "\n\nYour prior response was invalid. Return one exact list value only; no punctuation or explanation."
    return canonical_sector(call_llm(retry_prompt))


def latest_report_llm_sector(ticker: str) -> str | None:
    if not (os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL")):
        return None
    try:
        from .db.connection import connect

        with connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT a.dashboard #>> '{company_profile,sector}'
                  FROM reports r
                  JOIN report_artifacts a ON a.report_id = r.id
                 WHERE r.ticker = %s
                   AND r.deleted_at IS NULL
                   AND (
                       a.dashboard #>> '{company_profile,source}' LIKE 'llm.deepseek-v4-flash%'
                       OR a.dashboard #>> '{company_profile,source}' LIKE 'report.previous_llm%'
                   )
                 ORDER BY r.generated_at DESC, r.id DESC
                 LIMIT 1
                """,
                (ticker.upper(),),
            )
            row = cur.fetchone()
        return canonical_sector(row[0]) if row else None
    except Exception:
        return None


def resolve_sector_for_valuation(
    *,
    ticker: str,
    info_dict: dict[str, Any],
    analysis_text: str,
    call_llm: Callable[[str], str],
    prior_loader: Callable[[str], str | None] = latest_report_llm_sector,
) -> tuple[str | None, str]:
    existing = canonical_sector(resolve_company_profile(info_dict).get("sector"))
    if existing:
        return existing, resolve_company_profile(info_dict).get("source") or "company_profile"
    info = info_dict.get("info") if isinstance(info_dict.get("info"), Mapping) else {}
    name = str(info.get("shortName") or info.get("longName") or ticker)
    try:
        classified = classify_sector(ticker=ticker, company_name=name, analysis_text=analysis_text, call_llm=call_llm)
    except Exception:
        classified = None
    if classified:
        return classified, "llm.deepseek-v4-flash"
    prior = canonical_sector(prior_loader(ticker))
    if prior:
        return prior, "report.previous_llm"
    return None, "unavailable"
