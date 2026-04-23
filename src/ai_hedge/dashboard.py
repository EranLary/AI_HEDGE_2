from __future__ import annotations

import datetime as dt
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple


INSTRUCTION_EXECUTIVE_SUMMARY = """
Create a clean, well-written executive summary of the company, based only on the analysis document and financial data.

Goal:
Produce a strong management-style summary that explains the company clearly in simple professional language.
This summary should feel like a 1-2 page internal briefing note for an executive or decision-maker.

Important requirements:
- Explain the company in a logical narrative
- Make it easy to understand even for a smart reader who does not know the company well
- Focus on the business model, current position, recent financial direction, strengths, weaknesses, and key risks
- Use only the most important numbers
- Mention financial trends only when they materially improve understanding
- Make the write-up readable and elegant, not robotic
- Write the summary in clean Markdown with clear section headlines
- Use `##` and `###` subheadings where useful
- Use **bold** emphasis for key facts and turning points
- Keep paragraph flow natural and easy to scan
- The summary should be rich enough to stand on its own
- Keep it concise enough to roughly fit 1-2 pages when rendered normally

Return JSON in exactly this structure:

{
  "company": "<ticker or company name if clearly known from the materials>",
  "document_type": "executive_summary",
  "executive_summary": "<well-written markdown summary with section headlines and bold highlights>",
  "key_takeaways": [
    "<takeaway 1>",
    "<takeaway 2>",
    "<takeaway 3>",
    "<takeaway 4>",
    "<takeaway 5>"
  ]
}
""".strip()


INSTRUCTION_BULL_CASE = """
Build a strong "bull case" for the company.

Goal:
Extract and present 10-15 clear, high-quality reasons why this company could be a good investment.

Important requirements:
- Each point must be specific, meaningful, and grounded in the provided materials
- Focus on business quality, growth potential, market opportunity, competitive positioning, and financial trajectory
- Include both current strengths and future upside
- Prefer insight over obvious statements
- Avoid generic or vague bullets (e.g. "the company has potential")
- Avoid repeating the same idea in different wording
- Keep each bullet short, sharp, and easy to read (1-2 lines max)
- Write in simple, clear, professional language
Prioritize non-obvious insights over surface-level observations.
- Use **bold** emphasis for key facts and turning points
- Think like a smart investor trying to justify a position

Content to consider:
- Business model strength
- Revenue drivers and scalability
- Margin expansion potential
- Market size and growth
- Competitive advantages
- Product quality / differentiation
- Management execution
- Financial trends (only if meaningful)
- Strategic positioning
- Optionality / hidden upside
- Industry tailwinds

Do NOT:
- give a target price
- give a final recommendation
- write long explanations
- include filler or weak points just to reach the count

Return JSON in exactly this structure:

{
  "company": "<ticker or company name if clearly known>",
  "document_type": "bull_case",
  "reasons": [
    "<reason 1>",
    "<reason 2>",
    "<reason 3>",
    "... up to 10-15 total"
  ]
}
""".strip()


INSTRUCTION_BEAR_CASE = """
Build a strong "bear case" for the company.

Goal:
Extract and present 10-15 clear, high-quality reasons why this company could be a bad investment.

Important requirements:
- Focus on real risks, weaknesses, and red flags
- Each point must be specific, concrete, and grounded in the provided materials
- Prefer serious risks over minor concerns
- Be skeptical and critical, like a short-seller or risk manager
- Avoid generic statements (e.g. "competition exists")
- Avoid repeating the same idea in different wording
- Keep each bullet short, sharp, and easy to read (1-2 lines max)
- Use **bold** emphasis for key facts and turning points
- Clearly explain why each point matters when necessary
- Prioritize non-obvious insights over surface-level observations.
- Prioritize risks that could materially damage the business or valuation

Content to consider:
- Weak or deteriorating financial trends
- Margin pressure or lack of profitability
- Revenue quality issues
- Customer concentration or dependency risks
- Competitive threats or weak moat
- Industry headwinds
- Execution risks
- Capital allocation concerns
- Dilution / SBC / debt / liquidity risks
- Over-optimistic assumptions embedded in growth
- Structural weaknesses in the business model
- Regulatory or macro risks
- Any inconsistencies or warning signals in the data

Do NOT:
- give a target price
- give a final recommendation
- write long explanations
- include weak or obvious risks just to fill space

Return JSON in exactly this structure:

{
  "company": "<ticker or company name if clearly known>",
  "document_type": "bear_case",
  "reasons": [
    "<reason 1>",
    "<reason 2>",
    "<reason 3>",
    "... up to 10-15 total"
  ]
}
""".strip()


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _mean(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return float(sum(values) / len(values))


def _midpoint(value: Any) -> Optional[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    a = _safe_float(value[0])
    b = _safe_float(value[1])
    if a is None or b is None:
        return None
    return float((a + b) / 2.0)


def _truncate(text: Any, max_chars: int) -> str:
    t = str(text or "")
    if len(t) <= max_chars:
        return t
    return t[:max_chars]


def _parse_json_blob(text: str) -> Dict[str, Any]:
    if not text.strip():
        return {}
    cleaned = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).strip()
    if cleaned.startswith("{") and cleaned.endswith("}"):
        try:
            data = json.loads(cleaned)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
        if isinstance(data, dict):
            return data
    except Exception:
        return {}
    return {}


def _as_str_list(value: Any, max_items: int = 12) -> List[str]:
    if not isinstance(value, list):
        return []
    out: List[str] = []
    for item in value[:max_items]:
        txt = str(item or "").strip()
        if txt:
            out.append(txt)
    return out


def _first_non_empty(*values: Any) -> str:
    for value in values:
        txt = str(value or "").strip()
        if txt:
            return txt
    return ""


def _extract_rationale(raw_json: Mapping[str, Any]) -> str:
    preferred_keys = [
        "investment_rationale",
        "target_market_cap_rationale",
        "fcf_rationale",
        "net_income_rationale",
        "revenue_rationale",
        "wacc_rationale",
        "ev_sales_rationale",
    ]
    for key in preferred_keys:
        txt = str(raw_json.get(key, "")).strip()
        if txt:
            return txt
    for key, value in raw_json.items():
        if "rationale" in str(key).lower():
            txt = str(value or "").strip()
            if txt:
                return txt
    return ""


def _is_reason_key(key: str) -> bool:
    key_l = str(key).strip().lower()
    return key_l == "step_by_step_analysis" or "rationale" in key_l or "reason" in key_l


def _as_readable_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        chunks = [_as_readable_text(v) for v in value]
        chunks = [chunk for chunk in chunks if chunk]
        return "\n\n".join(chunks).strip()
    if isinstance(value, dict):
        parts: List[str] = []
        for key, nested in value.items():
            nested_txt = _as_readable_text(nested)
            if nested_txt:
                parts.append(f"{key}: {nested_txt}")
        return "\n\n".join(parts).strip()
    return str(value).strip()


def _extract_reason_sections(value: Any, prefix: str = "") -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            key_s = str(key)
            path = f"{prefix}.{key_s}" if prefix else key_s
            if _is_reason_key(key_s):
                txt = _as_readable_text(nested)
                if txt:
                    out.append((path, txt))
                continue
            out.extend(_extract_reason_sections(nested, path))
    elif isinstance(value, list):
        for idx, nested in enumerate(value):
            path = f"{prefix}[{idx}]" if prefix else f"[{idx}]"
            out.extend(_extract_reason_sections(nested, path))
    return out


def _extract_numeric_values(value: Any, prefix: str = "") -> List[Tuple[str, float]]:
    out: List[Tuple[str, float]] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            key_s = str(key)
            if _is_reason_key(key_s):
                continue
            path = f"{prefix}.{key_s}" if prefix else key_s
            out.extend(_extract_numeric_values(nested, path))
        return out
    if isinstance(value, list):
        for idx, nested in enumerate(value):
            path = f"{prefix}[{idx}]"
            out.extend(_extract_numeric_values(nested, path))
        return out
    if isinstance(value, bool):
        return out
    if isinstance(value, (int, float)):
        out.append((prefix or "value", float(value)))
    return out


def _normalize_metric_key(metric_path: str) -> str:
    metric_path = str(metric_path or "").strip()
    if not metric_path:
        return "value"
    leaf = metric_path.split(".")[-1]
    leaf = leaf.replace("[", "_").replace("]", "")
    leaf = re.sub(r"[^a-zA-Z0-9_]+", "_", leaf)
    leaf = re.sub(r"_+", "_", leaf).strip("_")
    if not leaf:
        leaf = re.sub(r"[^a-zA-Z0-9_]+", "_", metric_path)
        leaf = re.sub(r"_+", "_", leaf).strip("_")
    return leaf.lower() or "value"


def _metric_label(metric_key: str) -> str:
    known = {
        "wacc": "WACC",
        "fcf_next_year": "FCF Next Year",
        "pe_multiple": "P/E Multiple",
        "ev_sales_multiple": "EV/S Multiple",
        "net_income_3y": "Net Income (3Y)",
        "revenue_3y": "Revenue (3Y)",
        "target_market_cap": "Target Market Cap",
        "g": "Growth Rate",
        "terminal": "Terminal Growth",
    }
    key = str(metric_key or "").strip().lower()
    if key in known:
        return known[key]
    return key.replace("_", " ").title() if key else "Value"


def _parse_raw_json_from_item(item: Dict[str, Any]) -> Dict[str, Any]:
    raw_json = item.get("raw_json", {})
    if isinstance(raw_json, dict) and raw_json:
        return raw_json
    raw_json_text = str(item.get("raw_json_text", "") or "").strip()
    if raw_json_text.startswith("{") and raw_json_text.endswith("}"):
        try:
            parsed = json.loads(raw_json_text)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def _method_metric_snapshot(method_name: str, items: List[Dict[str, Any]]) -> Dict[str, float]:
    if not isinstance(items, list) or not items:
        return {}

    raw_list = []
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_json = _parse_raw_json_from_item(item)
        if raw_json:
            raw_list.append(raw_json)
    if not raw_list:
        return {}

    def avg_mid(key: str) -> Optional[float]:
        vals: List[float] = []
        for raw in raw_list:
            m = _midpoint(raw.get(key))
            if m is not None:
                vals.append(m)
        return _mean(vals)

    def avg_num(key: str) -> Optional[float]:
        vals: List[float] = []
        for raw in raw_list:
            n = _safe_float(raw.get(key))
            if n is not None:
                vals.append(n)
        return _mean(vals)

    def avg_scenario_value(scenario: str, idx: int) -> Optional[float]:
        vals: List[float] = []
        for raw in raw_list:
            value = raw.get(scenario)
            if isinstance(value, (list, tuple)) and len(value) > idx:
                n = _safe_float(value[idx])
                if n is not None:
                    vals.append(n)
        return _mean(vals)

    metrics: Dict[str, Optional[float]] = {}
    if method_name == "DCF":
        metrics = {
            "fcf_next_year": avg_mid("fcf_next_year"),
            "growth_rate": avg_mid("g"),
            "wacc": avg_mid("WACC"),
            "terminal_growth": avg_mid("TERMINAL"),
        }
    elif method_name == "Net Income & P/E":
        metrics = {
            "net_income_3y": avg_mid("net_income_3y"),
            "pe_multiple": avg_mid("pe_multiple"),
        }
    elif method_name == "Revenue & EV/S":
        metrics = {
            "revenue_3y": avg_mid("revenue_3y"),
            "ev_sales_multiple": avg_mid("ev_sales_multiple"),
        }
    elif method_name == "Dream Team":
        metrics = {
            "target_market_cap": avg_num("target_market_cap"),
        }
    elif method_name == "BBB Target":
        metrics = {
            "bull_target_market_cap": avg_scenario_value("bull", 1),
            "base_target_market_cap": avg_scenario_value("base", 1),
            "bear_target_market_cap": avg_scenario_value("bear", 1),
        }
    elif method_name == "BBB NI & P/E":
        metrics = {
            "bull_net_income": avg_scenario_value("bull", 1),
            "base_net_income": avg_scenario_value("base", 1),
            "bear_net_income": avg_scenario_value("bear", 1),
            "pe_multiple": avg_num("pe_multiple"),
        }
    elif method_name == "Lary's Logic":
        metrics = {
            "revenue_growth_3y_avg": avg_num("revenue_growth_3y_avg"),
            "operating_margin": avg_num("operating_profitability_margin"),
            "net_financing_result": avg_num("net_financing_result"),
            "pe_multiple": avg_num("pe_multiple"),
        }
    return {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))}


def _deterministic_red_flags(*, f_score_text: str, price_cv: Any, lmil: Any) -> List[str]:
    flags: List[str] = []
    _ = f_score_text

    cv = _safe_float(price_cv)
    if cv is not None and cv > 0.6:
        flags.append("High cross-model valuation dispersion (CV) indicates low agreement between methods.")

    if isinstance(lmil, (list, tuple)) and len(lmil) >= 2:
        lmil_mean = _safe_float(lmil[0])
        lmil_cv = _safe_float(lmil[1])
        if lmil_cv is not None and abs(lmil_cv) > 1.25:
            flags.append("Investment-vote volatility is elevated (LMIL CV), signaling fragile conviction.")
        if lmil_mean is not None and lmil_mean < 0:
            flags.append("Average model portfolio vote is net short (negative LMIL mean).")

    out: List[str] = []
    seen = set()
    for flag in flags:
        key = flag.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(flag)
    return out[:8]


def deterministic_red_flags(*, f_score_text: str, price_cv: Any, lmil: Any) -> List[str]:
    return _deterministic_red_flags(f_score_text=f_score_text, price_cv=price_cv, lmil=lmil)


def _fallback_qualitative_sections(
    *,
    analysis_text: str,
    sec_short_text: str,
    deterministic_red_flags: List[str],
) -> Dict[str, Any]:
    _ = deterministic_red_flags
    merged = (analysis_text or "").strip()
    if sec_short_text:
        merged = f"{merged}\n\n{sec_short_text}"

    bullets: List[str] = []
    for line in merged.splitlines():
        stripped = line.strip()
        if stripped.startswith("- ") and len(stripped) > 4:
            bullets.append(stripped[2:].strip())
        if len(bullets) >= 60:
            break

    bull_reasons = [
        x for x in bullets if any(k in x.lower() for k in ("growth", "margin", "moat", "advantage", "cash", "upside"))
    ][:15]
    bear_reasons = [
        x for x in bullets if any(k in x.lower() for k in ("risk", "decline", "dilution", "debt", "pressure", "weak"))
    ][:15]

    if not bull_reasons:
        bull_reasons = ["Fallback mode: structured bull-case extraction was unavailable for this run."]
    if not bear_reasons:
        bear_reasons = ["Fallback mode: structured bear-case extraction was unavailable for this run."]

    raw_summary = _truncate(merged, 7000) or "No analysis text available."
    exec_summary = (
        "## Business Overview\n"
        f"{raw_summary}\n\n"
        "## Investment Framing\n"
        "Use the bull and bear case tabs for concise position arguments."
    )
    exec_doc = {
        "company": "",
        "document_type": "executive_summary",
        "executive_summary": exec_summary,
        "key_takeaways": bullets[:5],
    }
    bull_doc = {
        "company": "",
        "document_type": "bull_case",
        "reasons": bull_reasons[:15],
    }
    bear_doc = {
        "company": "",
        "document_type": "bear_case",
        "reasons": bear_reasons[:15],
    }
    return {
        "documents": {
            "executive_summary": exec_doc,
            "bull_case": bull_doc,
            "bear_case": bear_doc,
        },
        "executive_summary_markdown": exec_summary,
        "bull_case_reasons": _as_str_list(bull_doc.get("reasons"), max_items=15),
        "bear_case_reasons": _as_str_list(bear_doc.get("reasons"), max_items=15),
        "key_insights": [],
        "bull_insights": _as_str_list(bull_doc.get("reasons"), max_items=10),
        "red_flags": [],
        "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
        "source": "fallback",
    }


def build_company_extraction_prompt(ticker: str, financial_dict: Dict[str, Any], text: str, instruction: str) -> str:
    financial_data = financial_dict.get("All Reports", "")
    currency_statement = financial_dict.get("currency_statement", "")
    today_date = dt.date.today().strftime("%Y-%m-%d")
    return f"""
You are a high-quality business analyst and financial writer.

Your job is NOT to produce a valuation, target price, portfolio decision, or investment recommendation.
Your job is to read:
1. An analytical summary about the company
2. The company's financial reports / financial data

Then extract the most important business and financial reality of the company and present it in a way that is:
- clear
- well-structured
- easy to understand
- insightful
- concise but informative
- written in professional but simple language

You are given:

<Ticker>
{ticker}
</Ticker>

<Analysis_Document>
{text}
</Analysis_Document>

<Financial_Data>
{financial_data}
{currency_statement}
</Financial_Data>

<General_Extraction_Guidelines>
Today's date is {today_date}.

Read all material carefully and extract the most important facts, patterns, and conclusions.

Focus on:
- what the company does
- how it makes money
- the current state of the business
- the main growth drivers
- the main profitability drivers
- key financial trends
- what is going well
- what is weakening
- the most important risks
- the few facts that really matter for understanding the company

When using financial information:
- prioritize the newest relevant annual and quarterly periods
- highlight trends, not random numbers
- do not overload the output with too many figures
- include only figures that truly improve understanding
- if a number is important, explain what it means
- if information is conflicting or unclear, say so carefully

Writing style:
- write like a strong analyst explaining the company to an intelligent manager
- be simple, direct, and readable
- avoid unnecessary jargon
- avoid hype
- avoid dramatic language
- avoid repeating the same point in different words
- prefer clarity over sophistication
- tell the story of the company in a logical order
- every statement must be grounded in the provided materials

Do not invent facts.
Do not guess missing data as if it were known.
Do not provide an investment recommendation.
Do not provide a target price.
Do not discuss valuation unless it is explicitly required in the output instructions.
</General_Extraction_Guidelines>

<Output_Instructions>
{instruction}
Output EXACTLY one JSON object and nothing else.
</Output_Instructions>
""".strip()


def _run_json_extraction_prompt(*, ticker: str, financial_dict: Dict[str, Any], text: str, instruction: str) -> Dict[str, Any]:
    from . import legacy_port as legacy

    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    prompt = build_company_extraction_prompt(
        ticker=ticker,
        financial_dict=financial_dict,
        text=_truncate(text, 150_000),
        instruction=instruction,
    )
    raw = legacy.deepseek_simple_text(
        api_key=api_key,
        prompt=prompt,
        model="deepseek-chat",
        temperature=0.25,
        short_answer=False,
    )
    return _parse_json_blob(raw)


def generate_dashboard_sections(
    *,
    ticker: str,
    analysis_text: str,
    sec_short_text: str,
    financial_dict: Dict[str, Any],
    deterministic_red_flags: List[str],
    enable_llm_extractions: bool = True,
) -> Dict[str, Any]:
    merged_text = (analysis_text or "").strip()
    if sec_short_text:
        merged_text = f"{merged_text}\n\n# SEC Short Analysis Context\n{sec_short_text}"

    if not enable_llm_extractions:
        out = _fallback_qualitative_sections(
            analysis_text=analysis_text,
            sec_short_text=sec_short_text,
            deterministic_red_flags=deterministic_red_flags,
        )
        out["source"] = "disabled"
        return out

    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        return _fallback_qualitative_sections(
            analysis_text=analysis_text,
            sec_short_text=sec_short_text,
            deterministic_red_flags=deterministic_red_flags,
        )

    try:
        exec_doc = _run_json_extraction_prompt(
            ticker=ticker,
            financial_dict=financial_dict,
            text=merged_text,
            instruction=INSTRUCTION_EXECUTIVE_SUMMARY,
        )
        bull_doc = _run_json_extraction_prompt(
            ticker=ticker,
            financial_dict=financial_dict,
            text=merged_text,
            instruction=INSTRUCTION_BULL_CASE,
        )
        bear_doc = _run_json_extraction_prompt(
            ticker=ticker,
            financial_dict=financial_dict,
            text=merged_text,
            instruction=INSTRUCTION_BEAR_CASE,
        )
    except Exception:
        return _fallback_qualitative_sections(
            analysis_text=analysis_text,
            sec_short_text=sec_short_text,
            deterministic_red_flags=deterministic_red_flags,
        )

    if not exec_doc or not bull_doc or not bear_doc:
        return _fallback_qualitative_sections(
            analysis_text=analysis_text,
            sec_short_text=sec_short_text,
            deterministic_red_flags=deterministic_red_flags,
        )

    bull_reasons = _as_str_list(bull_doc.get("reasons"), max_items=15)
    bear_reasons = _as_str_list(bear_doc.get("reasons"), max_items=15)

    executive_summary = _first_non_empty(exec_doc.get("executive_summary"), exec_doc.get("executive_summary_markdown"))
    if not executive_summary:
        executive_summary = "Executive summary extraction was empty."

    return {
        "documents": {
            "executive_summary": exec_doc,
            "bull_case": bull_doc,
            "bear_case": bear_doc,
        },
        "executive_summary_markdown": executive_summary,
        "bull_case_reasons": bull_reasons,
        "bear_case_reasons": bear_reasons,
        "key_insights": [],
        "bull_insights": bull_reasons[:10],
        "red_flags": [],
        "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
        "source": "llm",
    }


def build_dashboard_appendix_text(ticker: str, qualitative: Dict[str, Any]) -> str:
    docs = qualitative.get("documents", {}) if isinstance(qualitative, dict) else {}
    exec_doc = docs.get("executive_summary", {}) if isinstance(docs.get("executive_summary"), dict) else {}
    bull_doc = docs.get("bull_case", {}) if isinstance(docs.get("bull_case"), dict) else {}
    bear_doc = docs.get("bear_case", {}) if isinstance(docs.get("bear_case"), dict) else {}

    lines: List[str] = [
        f"# Dashboard Extraction Pack ({ticker})",
        "",
        "## Executive Summary",
        str(exec_doc.get("executive_summary", qualitative.get("executive_summary_markdown", ""))).strip(),
        "",
        "## Key Takeaways",
    ]
    for item in _as_str_list(exec_doc.get("key_takeaways"), max_items=10):
        lines.append(f"- {item}")

    lines.extend(["", "## Bull Case - Why This Could Be a Good Investment"])
    bull_reasons = _as_str_list(bull_doc.get("reasons"), max_items=15)
    if not bull_reasons:
        bull_reasons = _as_str_list(qualitative.get("bull_case_reasons"), max_items=15)
    for item in bull_reasons:
        lines.append(f"- {item}")

    lines.extend(["", "## Bear Case - Why This Could Be a Bad Investment"])
    bear_reasons = _as_str_list(bear_doc.get("reasons"), max_items=15)
    if not bear_reasons:
        bear_reasons = _as_str_list(qualitative.get("bear_case_reasons"), max_items=15)
    for item in bear_reasons:
        lines.append(f"- {item}")

    return "\n".join(lines).strip() + "\n"


def _build_method_tab(
    *,
    method_name: str,
    items: List[Dict[str, Any]],
    method_target: Optional[float],
    method_investment: Optional[float],
) -> Dict[str, Any]:
    outputs: List[Dict[str, Any]] = []
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        raw_json = _parse_raw_json_from_item(item)
        numeric_values = _extract_numeric_values(raw_json) if raw_json else []
        reason_sections = _extract_reason_sections(raw_json) if raw_json else []
        outputs.append(
            {
                "output_id": idx,
                "persona": str(item.get("persona", "") or "").strip(),
                "target_price": _safe_float(item.get("target_price")),
                "investment_amount": _safe_float(item.get("investment_amount")),
                "key_numeric_values": [
                    {
                        "path": path,
                        "metric_key": _normalize_metric_key(path),
                        "label": _metric_label(_normalize_metric_key(path)),
                        "value": value,
                    }
                    for path, value in numeric_values
                ],
                "reason_sections": [
                    {
                        "path": path,
                        "label": path.replace("_", " "),
                        "text": text,
                    }
                    for path, text in reason_sections
                ],
            }
        )
    return {
        "name": method_name,
        "target_price": method_target,
        "investment_amount": method_investment,
        "key_metric_means": _method_metric_snapshot(method_name, items),
        "outputs": outputs,
    }


def _build_all_values_payload(method_details: Dict[str, Any]) -> Dict[str, Any]:
    metric_map: Dict[str, Dict[str, Any]] = {}
    source_values: List[Dict[str, Any]] = []

    for method_name, items in method_details.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            persona = str(item.get("persona", "") or "").strip()
            raw_json = _parse_raw_json_from_item(item)
            if not raw_json:
                continue
            for path, value in _extract_numeric_values(raw_json):
                key = _normalize_metric_key(path)
                rec = metric_map.setdefault(
                    key,
                    {
                        "metric_key": key,
                        "label": _metric_label(key),
                        "values": [],
                        "methods": set(),
                        "source_paths": set(),
                    },
                )
                rec["values"].append(float(value))
                rec["methods"].add(str(method_name))
                rec["source_paths"].add(path)
                source_values.append(
                    {
                        "method": str(method_name),
                        "persona": persona,
                        "metric_key": key,
                        "metric_path": path,
                        "label": _metric_label(key),
                        "value": float(value),
                    }
                )

    metric_means: List[Dict[str, Any]] = []
    for rec in metric_map.values():
        vals = [float(v) for v in rec.get("values", []) if isinstance(v, (int, float))]
        if not vals:
            continue
        metric_means.append(
            {
                "metric_key": rec["metric_key"],
                "label": rec["label"],
                "mean": float(sum(vals) / len(vals)),
                "min": float(min(vals)),
                "max": float(max(vals)),
                "sample_count": len(vals),
                "method_count": len(rec["methods"]),
                "methods": sorted(rec["methods"]),
                "source_paths": sorted(rec["source_paths"])[:12],
            }
        )

    metric_means.sort(key=lambda x: x["label"])
    source_values.sort(key=lambda x: (x["method"], x["metric_key"], x["persona"]))
    return {
        "metric_means": metric_means,
        "source_values": source_values,
    }


def build_dashboard_payload(
    *,
    ticker: str,
    info_dict: Dict[str, Any],
    financial_dict: Dict[str, Any],
    variables_dict: Dict[str, Any],
    final_dict: Dict[str, Any],
    explain_payload: Dict[str, Any],
    analysis_text: str,
    sec_short_text: str,
    artifacts: Dict[str, str],
    qualitative_sections: Optional[Dict[str, Any]] = None,
    enable_llm_extractions: bool = True,
) -> Dict[str, Any]:
    info = info_dict.get("info", {}) if isinstance(info_dict, dict) else {}
    prices = final_dict.get("Prices", {}) if isinstance(final_dict.get("Prices"), dict) else {}
    current_price = _safe_float(prices.get("Current")) or _safe_float(variables_dict.get("price")) or 0.0
    overall = prices.get("Overall") if isinstance(prices.get("Overall"), (list, tuple)) else []
    consensus_price = _safe_float(overall[0]) if len(overall) >= 1 else None
    confidence_std = _safe_float(prices.get("STD"))
    confidence_cv = _safe_float(prices.get("CV"))
    lmil = prices.get("LMIL") if isinstance(prices.get("LMIL"), (list, tuple)) else []

    deterministic_red_flags = _deterministic_red_flags(
        f_score_text=str(variables_dict.get("f_score", "") or ""),
        price_cv=confidence_cv,
        lmil=lmil,
    )
    qualitative = qualitative_sections or generate_dashboard_sections(
        ticker=ticker,
        analysis_text=analysis_text,
        sec_short_text=sec_short_text,
        financial_dict=financial_dict,
        deterministic_red_flags=deterministic_red_flags,
        enable_llm_extractions=enable_llm_extractions,
    )

    method_details = explain_payload.get("methods", {}) if isinstance(explain_payload, dict) else {}
    aggregate_targets = explain_payload.get("aggregate_targets", {}) if isinstance(explain_payload, dict) else {}
    aggregate_investments = explain_payload.get("aggregate_investments", {}) if isinstance(explain_payload, dict) else {}
    method_order = [
        "DCF",
        "Net Income & P/E",
        "Revenue & EV/S",
        "Dream Team",
        "BBB Target",
        "BBB NI & P/E",
        "Lary's Logic",
    ]

    method_blocks: List[Dict[str, Any]] = []
    method_tabs: List[Dict[str, Any]] = []
    for method_name in method_order:
        items = method_details.get(method_name, []) if isinstance(method_details, dict) else []
        target_price = _safe_float(aggregate_targets.get(method_name)) if isinstance(aggregate_targets, dict) else None
        investment_amount = (
            _safe_float(aggregate_investments.get(method_name))
            if isinstance(aggregate_investments, dict)
            else None
        )
        investment_pct = (investment_amount / 100000.0) * 100.0 if investment_amount is not None else None
        upside_pct = ((target_price - current_price) / current_price) * 100.0 if (target_price is not None and current_price) else None

        sample_rationale = ""
        if isinstance(items, list) and items:
            raw_json = _parse_raw_json_from_item(items[0]) if isinstance(items[0], dict) else {}
            if isinstance(raw_json, dict):
                sample_rationale = _extract_rationale(raw_json)

        method_blocks.append(
            {
                "name": method_name,
                "target_price": target_price,
                "upside_pct": upside_pct,
                "investment_amount": investment_amount,
                "investment_pct": investment_pct,
                "key_metric_means": _method_metric_snapshot(method_name, items),
                "sample_rationale": sample_rationale,
            }
        )
        method_tabs.append(
            _build_method_tab(
                method_name=method_name,
                items=items if isinstance(items, list) else [],
                method_target=target_price,
                method_investment=investment_amount,
            )
        )

    all_values_payload = _build_all_values_payload(method_details if isinstance(method_details, dict) else {})

    dream_cards: List[Dict[str, Any]] = []
    for item in method_details.get("Dream Team", []) if isinstance(method_details, dict) else []:
        if not isinstance(item, dict):
            continue
        raw_json = _parse_raw_json_from_item(item)
        dream_cards.append(
            {
                "persona": str(item.get("persona", "") or "").strip(),
                "target_price": _safe_float(item.get("target_price")),
                "target_market_cap": _safe_float(raw_json.get("target_market_cap")),
                "investment_amount": _safe_float(item.get("investment_amount")),
                "investment_rationale": _first_non_empty(
                    raw_json.get("investment_rationale"),
                    raw_json.get("target_market_cap_rationale"),
                ),
            }
        )

    shift_raw = _safe_float(info_dict.get("change")) if isinstance(info_dict, dict) else None
    structural_direction = "none"
    if shift_raw is not None:
        if shift_raw >= 0.35:
            structural_direction = "up"
        elif shift_raw <= -0.35:
            structural_direction = "down"

    mean_investment = _safe_float(prices.get("LMIL Mean Investment"))
    action = "HOLD / NEUTRAL"
    position_size_pct = 0.0
    if mean_investment is not None:
        position_size_pct = (mean_investment / 100000.0) * 100.0
        if mean_investment > 10000:
            action = "LONG"
        elif mean_investment < -10000:
            action = "SHORT"

    return {
        "dashboard_version": "v2",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ticker": ticker,
        "header": {
            "company_name": _first_non_empty(info.get("shortName"), info.get("longName"), ticker),
            "current_price": current_price,
            "market_cap": _safe_float(variables_dict.get("market_cap")),
            "shares_outstanding": _safe_float(variables_dict.get("shares_outstanding")),
            "currency": _first_non_empty(info.get("currency"), "USD"),
            "f_score_text": str(variables_dict.get("f_score", "") or ""),
        },
        "red_flag_shield": [],
        "analysis_matrix": {
            "executive_summary_markdown": qualitative.get("executive_summary_markdown", ""),
            "bull_case_reasons": qualitative.get("bull_case_reasons", []),
            "bear_case_reasons": qualitative.get("bear_case_reasons", []),
            "key_insights": qualitative.get("key_insights", []),
            "bull_insights": qualitative.get("bull_insights", []),
            "red_flag_insights": [],
            "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
            "documents": qualitative.get("documents", {}),
            "structural_shift": {
                "triggered": structural_direction in {"up", "down"},
                "direction": structural_direction,
                "change_pct_52w": (shift_raw * 100.0) if shift_raw is not None else None,
            },
            "source": qualitative.get("source", "fallback"),
        },
        "valuation_hub": {
            "method_blocks": method_blocks,
            "method_tabs": method_tabs,
            "all_values": all_values_payload,
            "consensus": {
                "current_price": current_price,
                "mean_target_price": consensus_price,
                "std": confidence_std,
                "cv": confidence_cv,
                "lmil": lmil,
            },
            "prices": final_dict.get("Prices", {}),
            "revenue": final_dict.get("Revenue", {}),
            "net_income": final_dict.get("Net Income", {}),
            "pe": final_dict.get("P/E", {}),
        },
        "dream_team": dream_cards,
        "forecast_forensic_matrix": {
            "current_revenue": _safe_float(final_dict.get("Revenue", {}).get("Current")),
            "target_revenue": _safe_float(final_dict.get("Revenue", {}).get("Overall", [None])[0]),
            "current_earnings": _safe_float(final_dict.get("Net Income", {}).get("Current")),
            "target_earnings": _safe_float(final_dict.get("Net Income", {}).get("Overall", [None])[0]),
            "forensic_flags": _as_str_list(qualitative.get("bear_case_reasons"), max_items=6),
        },
        "decision_card": {
            "action": action,
            "position_size_pct_of_notional": position_size_pct,
            "mean_investment_amount": mean_investment,
            "rationale": "Signal is derived from cross-model investment votes and LMIL dispersion.",
        },
        "artifacts": artifacts,
    }


def write_dashboard_payload(path: str | Path, payload: Dict[str, Any]) -> str:
    target = Path(path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(target)
