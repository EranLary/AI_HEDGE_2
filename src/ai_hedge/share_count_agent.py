"""Filing-grounded share-count verification for valuation denominators.

Yahoo is useful for a fast market snapshot, but its ``sharesOutstanding`` can
describe only the traded class.  This module gives the valuation run one
additional, bounded review step: use the most recent official filing text to
confirm a total-company common/ordinary share count.  It never lets a model
invent a value: an official-filing answer is accepted only when the quoted
evidence is present verbatim in the supplied filing text; otherwise the
existing deterministic provider fallback remains in effect.
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Callable, Dict, Optional


_SHARE_TERMS_RE = re.compile(
    r"(?:shares?\s+outstanding|ordinary\s+shares?|common\s+(?:stock|shares?))",
    re.IGNORECASE,
)
_WHITESPACE_RE = re.compile(r"\s+")


def _positive_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def _finite_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _normalise(value: Any) -> str:
    return _WHITESPACE_RE.sub(" ", str(value or "")).strip()


def _same_number(left: float, right: float) -> bool:
    return math.isclose(left, right, rel_tol=0.001, abs_tol=1.0)


def provider_share_candidates(info_dict: Optional[Dict[str, Any]], current_value: Any) -> Dict[str, float]:
    """Return only total-company-safe deterministic provider candidates.

    ``sharesOutstanding`` is deliberately excluded because it can be a single
    quoted share class.  This mirrors the existing valuation gate in
    ``legacy_port._select_shares_outstanding``.
    """
    info = info_dict if isinstance(info_dict, dict) else {}
    nested_info = info.get("info") if isinstance(info.get("info"), dict) else None
    if nested_info is not None:
        info = nested_info
    candidates: Dict[str, float] = {}
    current = _positive_number(current_value)
    if current is not None:
        candidates["current_valuation_denominator"] = current

    implied = _positive_number(info.get("impliedSharesOutstanding"))
    if implied is not None:
        candidates["provider_implied_shares"] = implied

    market_cap = _positive_number(info.get("marketCap"))
    price = _positive_number(info.get("currentPrice"))
    if market_cap is not None and price is not None:
        candidates["market_cap_div_current_price"] = market_cap / price

    return candidates


def _filing_label(form_type: Any, payload: Dict[str, Any]) -> str:
    label = str(form_type or "Official filing").strip() or "Official filing"
    date = str(payload.get("date", "") or "").strip()
    source = str(payload.get("source", "") or "").strip().upper()
    suffix = " ".join(part for part in (source, date) if part)
    return f"{label} ({suffix})" if suffix else label


def filing_share_count_evidence(files_dict: Optional[Dict[str, Any]]) -> str:
    """Extract bounded, verbatim share-count neighborhoods from filings."""
    if not isinstance(files_dict, dict):
        return ""

    excerpts: list[str] = []
    for form_type, raw in files_dict.items():
        if not isinstance(raw, dict):
            continue
        filing_text = str(raw.get("text", "") or "")
        if not filing_text.strip():
            continue
        for match in _SHARE_TERMS_RE.finditer(filing_text):
            start = max(0, match.start() - 650)
            end = min(len(filing_text), match.end() + 950)
            excerpt = filing_text[start:end].strip()
            if excerpt:
                excerpts.append(f"[SOURCE: {_filing_label(form_type, raw)}]\n{excerpt}")
            if len(excerpts) >= 18:
                break
        if len(excerpts) >= 18:
            break
    return "\n\n---\n\n".join(excerpts)


def _fallback_resolution(candidates: Dict[str, float], *, reason: str) -> Dict[str, Any]:
    for key in (
        "current_valuation_denominator",
        "provider_implied_shares",
        "market_cap_div_current_price",
    ):
        value = candidates.get(key)
        if value is not None:
            return {
                "status": "fallback",
                "selected_shares_outstanding": value,
                "source_type": "provider_fallback",
                "basis": key,
                "as_of_date": None,
                "evidence_excerpt": "",
                "calculation": "",
                "confidence": "Low",
                "fallback_used": True,
                "validation_note": reason,
                "provider_candidates": candidates,
            }
    return {
        "status": "unavailable",
        "selected_shares_outstanding": None,
        "source_type": "unavailable",
        "basis": "no_total_company_candidate",
        "as_of_date": None,
        "evidence_excerpt": "",
        "calculation": "",
        "confidence": "Low",
        "fallback_used": True,
        "validation_note": reason,
        "provider_candidates": candidates,
    }


def _share_count_prompt(*, ticker: str, candidates: Dict[str, float], evidence: str) -> str:
    candidate_lines = "\n".join(f"- {name}: {value:,.0f}" for name, value in candidates.items())
    return f"""You are a filing-verification agent for the valuation denominator of {ticker}.

Your only job is to select the most defensible TOTAL COMPANY common/ordinary shares outstanding count for a per-share valuation. Prefer an explicit count in the latest official filing evidence below. Do not use a count for only one quoted class. Do not infer, calculate, or repair a filing number.

Provider candidates (fallback only; do not treat as filing evidence):
{candidate_lines or "- none"}

Official filing evidence (the excerpt you return must be copied exactly from this text):
{evidence}

Return one JSON object only, with exactly these keys:
{{
  "selected_shares_outstanding": number or null,
  "source_type": "official_filing" or "provider_fallback",
  "basis": "short description",
  "as_of_date": "YYYY-MM-DD" or null,
  "evidence_excerpt": "verbatim official-filing text supporting the selected count, or empty string for fallback",
  "calculation": "empty unless a provider fallback explicitly uses market_cap_div_current_price",
  "confidence": "High", "Medium", or "Low"
}}

Rules:
1. Select "official_filing" only when the excerpt explicitly reports TOTAL common/ordinary shares outstanding; copy supporting text verbatim.
2. A class-A/class-B or other single-class count is not a total-company denominator unless the text explicitly states it is the total number of shares outstanding.
3. If the filing evidence is ambiguous or absent, use "provider_fallback" and select exactly one provider candidate value. Never make up a number.
4. Do not include prose, Markdown, or a JSON code fence."""


def _parse_json_object(text: Any) -> Optional[Dict[str, Any]]:
    raw = str(text or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else ""
        raw = raw.rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _validate_agent_resolution(
    payload: Optional[Dict[str, Any]],
    *,
    candidates: Dict[str, float],
    filing_evidence: str,
) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    selected = _positive_number(payload.get("selected_shares_outstanding"))
    source_type = str(payload.get("source_type", "") or "").strip()
    if selected is None or source_type not in {"official_filing", "provider_fallback"}:
        return None

    evidence_excerpt = str(payload.get("evidence_excerpt", "") or "").strip()
    if source_type == "official_filing":
        # This is the central anti-hallucination gate: the supporting quotation
        # must actually occur in a SEC/MAYA filing excerpt supplied to the LLM.
        if not evidence_excerpt or _normalise(evidence_excerpt) not in _normalise(filing_evidence):
            return None
        if not _SHARE_TERMS_RE.search(evidence_excerpt):
            return None
        reported_digits = re.sub(r"\D", "", evidence_excerpt)
        selected_digits = str(int(round(selected)))
        if selected_digits not in reported_digits:
            return None
    else:
        if not any(_same_number(selected, candidate) for candidate in candidates.values()):
            return None
        return _fallback_resolution(
            candidates,
            reason="Official filing evidence was ambiguous; retained the existing provider denominator.",
        )

    confidence = str(payload.get("confidence", "") or "").strip().title()
    if confidence not in {"High", "Medium", "Low"}:
        confidence = "Medium" if source_type == "official_filing" else "Low"
    return {
        "status": "verified" if source_type == "official_filing" else "fallback",
        "selected_shares_outstanding": selected,
        "source_type": source_type,
        "basis": str(payload.get("basis", "") or "").strip(),
        "as_of_date": str(payload.get("as_of_date", "") or "").strip() or None,
        "evidence_excerpt": evidence_excerpt,
        "calculation": str(payload.get("calculation", "") or "").strip(),
        "confidence": confidence,
        "fallback_used": source_type != "official_filing",
        "validation_note": "Accepted after deterministic evidence validation.",
        "provider_candidates": candidates,
    }


def resolve_share_count(
    *,
    ticker: str,
    info_dict: Optional[Dict[str, Any]],
    files_dict: Optional[Dict[str, Any]],
    current_value: Any,
    api_key: str,
    llm_call: Optional[Callable[..., str]] = None,
) -> Dict[str, Any]:
    """Resolve a valuation share count with an official-filing-first review.

    Any error, unavailable filing text, malformed model response, or failed
    evidence check deliberately returns the deterministic provider fallback.
    Valuation therefore remains available while no unsupported number reaches
    the pricing formulas.
    """
    candidates = provider_share_candidates(info_dict, current_value)
    evidence = filing_share_count_evidence(files_dict)
    if not evidence:
        return _fallback_resolution(candidates, reason="No official filing share-count evidence was available.")
    if not str(api_key or "").strip() and llm_call is None:
        return _fallback_resolution(candidates, reason="Share-count verification skipped because the LLM API key was unavailable.")

    if llm_call is None:
        from .legacy_port import deepseek_simple_text

        llm_call = deepseek_simple_text

    try:
        response = llm_call(
            api_key=str(api_key or "").strip(),
            prompt=_share_count_prompt(ticker=ticker, candidates=candidates, evidence=evidence),
            model="deepseek-chat",
            temperature=0.0,
            short_answer=True,
            max_retries=2,
        )
        validated = _validate_agent_resolution(
            _parse_json_object(response),
            candidates=candidates,
            filing_evidence=evidence,
        )
        if validated is not None:
            return validated
        return _fallback_resolution(candidates, reason="Share-count agent response failed deterministic validation.")
    except Exception as exc:  # The valuation fallback must remain non-blocking.
        return _fallback_resolution(candidates, reason=f"Share-count agent unavailable: {type(exc).__name__}.")


def apply_share_count_resolution(variables_dict: Dict[str, Any], resolution: Dict[str, Any]) -> Dict[str, Any]:
    """Apply one verified denominator and refresh dependent market-cap / EV fields."""
    updated = dict(variables_dict or {})
    selected = _positive_number(resolution.get("selected_shares_outstanding") if isinstance(resolution, dict) else None)
    if selected is None:
        return updated

    updated["shares_outstanding"] = selected
    updated["share_count_resolution"] = dict(resolution)
    price = _positive_number(updated.get("price"))
    if price is not None:
        updated["market_cap"] = price * selected
        updated["market_cap_source"] = "verified_shares_x_current_price"

    debt = _finite_number(updated.get("total_debt"))
    cash = _finite_number(updated.get("total_cash"))
    market_cap = _positive_number(updated.get("market_cap")) or 0.0
    if debt is not None and cash is not None:
        updated["ev"] = market_cap + debt - cash
        updated["ev_source"] = "statement_net_debt_verified_shares"
    else:
        updated["ev"] = market_cap
        updated["ev_source"] = "market_cap_fallback_missing_statement_net_debt"
    updated["differnce"] = updated["ev"] - market_cap
    return updated


def format_share_count_resolution_markdown(resolution: Dict[str, Any]) -> str:
    """Render a concise, provenance-first section for the analysis Markdown."""
    payload = resolution if isinstance(resolution, dict) else {}
    selected = _positive_number(payload.get("selected_shares_outstanding"))
    lines = [
        "This denominator is used consistently for market capitalization, enterprise value, and every per-share valuation output.",
        f"- Status: {payload.get('status', 'unavailable')}",
        f"- Selected total-company shares: {selected:,.0f}" if selected is not None else "- Selected total-company shares: unavailable",
        f"- Source: {payload.get('source_type', 'unavailable')}",
        f"- Basis: {payload.get('basis', 'unavailable')}",
        f"- As-of date: {payload.get('as_of_date') or 'not stated'}",
        f"- Confidence: {payload.get('confidence', 'Low')}",
    ]
    evidence = str(payload.get("evidence_excerpt", "") or "").strip()
    if evidence:
        lines.extend(["", "**Official filing evidence (verbatim):**", f"> {evidence.replace(chr(10), chr(10) + '> ')}"])
    elif payload.get("validation_note"):
        lines.append(f"- Fallback note: {payload['validation_note']}")
    return "\n".join(lines).strip()
