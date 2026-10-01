from __future__ import annotations

from typing import Any, Dict


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def resolve_company_profile(info_dict: Dict[str, Any] | None) -> Dict[str, str]:
    """Resolve the current ticker classification from data already collected.

    The analysis-time yfinance ``Ticker.info`` payload is authoritative because
    it is also the source used by sector-gated valuation logic. YahooQuery's
    asset profile is only a field-level fallback and does not trigger another
    provider request here.
    """

    payload = info_dict if isinstance(info_dict, dict) else {}
    override = payload.get("company_profile_override") if isinstance(payload.get("company_profile_override"), dict) else {}
    info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
    yahooquery = payload.get("yahooquery") if isinstance(payload.get("yahooquery"), dict) else {}
    yahooquery_profile = (
        yahooquery.get("company_profile")
        if isinstance(yahooquery.get("company_profile"), dict)
        else {}
    )

    sector_from_override = _clean_text(override.get("sector"))
    industry_from_override = _clean_text(override.get("industry"))
    override_source = _clean_text(override.get("source"))
    sector_from_info = _clean_text(info.get("sector"))
    industry_from_info = _clean_text(info.get("industry"))
    sector_from_yahooquery = _clean_text(yahooquery_profile.get("sector"))
    industry_from_yahooquery = _clean_text(yahooquery_profile.get("industry"))

    sector = sector_from_override or sector_from_info or sector_from_yahooquery
    industry = industry_from_override or industry_from_info or industry_from_yahooquery
    sources = []
    if sector_from_override or industry_from_override:
        sources.append(override_source or "report.sector_override")
    if (not sector_from_override and sector_from_info) or (not industry_from_override and industry_from_info):
        sources.append("yfinance.info")
    if (not sector_from_override and not sector_from_info and sector_from_yahooquery) or (
        not industry_from_override and not industry_from_info and industry_from_yahooquery
    ):
        sources.append("yahooquery.asset_profile")

    return {
        "sector": sector,
        "industry": industry,
        "source": "+".join(sources),
    }
