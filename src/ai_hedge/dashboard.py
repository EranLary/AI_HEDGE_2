from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

import yfinance as yf


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
Extract and present the 4-7 most important, high-quality reasons why this company could be a good investment.

Important requirements:
- Each point must be specific, meaningful, and grounded in the provided materials
- Focus on business quality, growth potential, market opportunity, competitive positioning, and financial trajectory
- Include both current strengths and future upside
- Select only the most important supported points; do not include every possible positive bullet
- Order reasons by importance, with the strongest and most valuation-relevant point first
- Prefer insight over obvious statements
- If the evidence is ordinary, mixed, or thin, say so plainly.
- Do not force a non-obvious insight when the provided materials do not support one.
- Distinguish evidence, inference, and speculation.
- A neutral or low-conviction conclusion is acceptable.
- Do not make the bull case stronger than the provided data supports.
- Avoid generic or vague bullets (e.g. "the company has potential")
- Avoid repeating the same idea in different wording
- Keep each bullet short, sharp, and easy to read (1-2 lines max)
- Write in simple, clear, professional language
- Prioritize non-obvious insights over surface-level observations.
- Every bullet must begin with a short bold theme prefix (2-5 words) that captures the core point.
- Use this exact style: **<Theme Prefix>:** <specific reason and why it matters>
- Example: **Pricing Power:** Gross margins expanded despite cost pressure, signaling durable customer willingness to pay.
- Keep the prefix tight and descriptive (not generic words like "Good" or "Positive").
- Think like a smart investor trying to justify a position
- make at readible interstingly, not robotic

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
- include more than 7 reasons
- include 4 reasons if fewer than 4 are genuinely supported

Return JSON in exactly this structure:

{
  "company": "<ticker or company name if clearly known>",
  "document_type": "bull_case",
  "reasons": [
    "<reason 1>",
    "<reason 2>",
    "<reason 3>",
    "... 4-7 total, ranked strongest first"
  ]
}
""".strip()


INSTRUCTION_BEAR_CASE = """
Build a strong "bear case" for the company.

Goal:
Extract and present the 4-7 most important, high-quality reasons why this company could be a bad investment.

Important requirements:
- Focus on real risks, weaknesses, and red flags
- Each point must be specific, concrete, and grounded in the provided materials
- Select only the most important supported risks; do not include every possible negative bullet
- Order reasons by importance, with the strongest and most valuation-relevant risk first
- Prefer serious risks over minor concerns
- Be skeptical and critical, like a short-seller or risk manager
- If the evidence is ordinary, mixed, or thin, say so plainly.
- Do not force a non-obvious risk when the provided materials do not support one.
- Distinguish evidence, inference, and speculation.
- A neutral or low-conviction conclusion is acceptable.
- Do not make the bear case stronger than the provided data supports.
- Avoid generic statements (e.g. "competition exists")
- Avoid repeating the same idea in different wording
- Keep each bullet short, sharp, and easy to read (1-2 lines max)
- Every bullet must begin with a short bold theme prefix (2-5 words) that captures the core point.
- Use this exact style: **<Theme Prefix>:** <specific risk and why it matters>
- Example: **Customer Concentration:** One major client drives a large share of revenue, creating meaningful downside if demand weakens.
- Keep the prefix tight and descriptive (not generic words like "Risk" or "Concern").
- Clearly explain why each point matters when necessary
- Prioritize non-obvious insights over surface-level observations.
- Prioritize risks that could materially damage the business or valuation
- make at readible interstingly, not robotic

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
- include more than 7 risks
- include 4 risks if fewer than 4 are genuinely supported

Return JSON in exactly this structure:

{
  "company": "<ticker or company name if clearly known>",
  "document_type": "bear_case",
  "reasons": [
    "<reason 1>",
    "<reason 2>",
    "<reason 3>",
    "... 4-7 total, ranked strongest first"
  ]
}
""".strip()


INSTRUCTION_MAIN_THESIS_KPIS = """
Build the stock's "main thesis and KPI watchlist" for the dashboard.

Goal:
Extract the 1-3 most important questions an investor must answer about this stock, and the 3-7 most important KPIs to monitor to understand where the company is going.

Important requirements:
- Think like a sharp portfolio manager setting up the real debate on the stock
- The questions should frame what valuation mainly revolves around, not generic business questions
- Start each question with "Can", "Will", "Is", "Does", "How", or "What" when natural
- Each question must be answerable by future evidence, numbers, execution, or market behavior
- Prioritize questions that would most change the intrinsic value, multiple, or margin of safety
- Order questions by importance, with the most valuation-critical question first
- KPIs must be concrete signals to watch, not vague ideas
- KPIs may be financial, operating, customer, margin, cash-flow, balance-sheet, market-share, pricing, retention, regulatory, or execution metrics
- For each KPI, explain why it matters and what direction or threshold would be good or bad when the materials support it
- Order KPIs by importance, with the most thesis-critical KPI first
- Use only the provided materials; do not invent company-specific metrics that are not supported
- If the evidence is thin, prefer broad but still concrete KPIs that can be tracked from future reports
- Keep every field concise, readable, and investor-grade
- Distinguish evidence from inference when needed
- Do not give a target price, final recommendation, or portfolio action

Return JSON in exactly this structure:

{
  "company": "<ticker or company name if clearly known>",
  "document_type": "main_thesis_kpis",
  "valuation_revolves_around": "<one concise sentence beginning with 'The questions surrounding valuation revolve around...'>",
  "main_questions": [
    "<question 1>",
    "<question 2>",
    "<question 3>"
  ],
  "kpis": [
    {
      "name": "<short KPI name>",
      "why_it_matters": "<why this KPI is thesis-relevant>",
      "direction_to_watch": "<what improving or worsening evidence would look like>"
    }
  ]
}
""".strip()


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        result = float(value)
        if not math.isfinite(result):
            return None
        return result
    except Exception:
        return None


def _json_safe(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    return value


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


def _as_str_list(value: Any, max_items: Optional[int] = 12) -> List[str]:
    if not isinstance(value, list):
        return []
    out: List[str] = []
    items = value if max_items is None else value[:max_items]
    for item in items:
        txt = str(item or "").strip()
        if txt:
            out.append(txt)
    return out


def _as_kpi_list(value: Any, max_items: Optional[int] = 7) -> List[Dict[str, str]]:
    if not isinstance(value, list):
        return []
    out: List[Dict[str, str]] = []
    items = value if max_items is None else value[:max_items]
    for item in items:
        if isinstance(item, dict):
            name = str(item.get("name") or item.get("metric") or item.get("kpi") or "").strip()
            why = str(item.get("why_it_matters") or item.get("why") or item.get("importance") or "").strip()
            direction = str(item.get("direction_to_watch") or item.get("watch") or item.get("trend_to_watch") or "").strip()
        else:
            name = str(item or "").strip()
            why = ""
            direction = ""
        if name or why or direction:
            out.append(
                {
                    "name": name,
                    "why_it_matters": why,
                    "direction_to_watch": direction,
                }
            )
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


def _extract_analysis_section(text: str, header: str) -> str:
    src = str(text or "").replace("\r\n", "\n")
    if not src.strip():
        return ""
    target = str(header or "").strip().rstrip(":").lower()
    lines = src.split("\n")
    plain_headers = {
        "what the company is doing",
        "general information insights",
        "news review",
        "options insights",
        "analyst expectations insights",
        "holders analysis",
        "swot analysis",
        "market analysis",
        "bull vs bear thesis",
        "significant change analysis",
        "key insights for valuation",
        "street analysis",
        "overall valuations",
        "our analysts price valuations",
        "final table",
        "competitor market review",
    }

    def _section_heading(line: str) -> Optional[str]:
        match = re.match(r"^\s*#{1,6}\s+(.+?)\s*:?\s*$", line)
        if match:
            return match.group(1).strip().rstrip(":")
        match = re.match(r"^\s*([A-Z][A-Za-z0-9 &/().,'+-]{2,80})\s*:\s*$", line)
        if match:
            heading = match.group(1).strip().rstrip(":")
            if heading.lower() in plain_headers or heading.lower().endswith(" insights"):
                return heading
        return None

    start: Optional[int] = None
    for idx, line in enumerate(lines):
        heading = _section_heading(line)
        if heading and heading.lower() == target:
            start = idx + 1
            break
    if start is None:
        return ""
    end = len(lines)
    for idx in range(start, len(lines)):
        if _section_heading(lines[idx]):
            end = idx
            break
    return "\n".join(lines[start:end]).strip()


def _normalize_market_review_payload(
    payload: Optional[Dict[str, Any]],
    *,
    analysis_text: str,
) -> Dict[str, Any]:
    raw = payload if isinstance(payload, dict) else {}
    competitor_text = str(raw.get("review_markdown") or "").strip()
    if not competitor_text:
        competitor_text = _extract_analysis_section(analysis_text, "Competitor Market Review")
    market_agent_text = str(raw.get("market_agent_markdown") or "").strip()
    if not market_agent_text:
        market_agent_text = _extract_analysis_section(analysis_text, "Market Analysis")
    competitors = raw.get("competitors")
    if not isinstance(competitors, list):
        competitors = []
    original_company = raw.get("original_company")
    if not isinstance(original_company, dict):
        original_company = {}
    status = str(raw.get("status") or ("success" if competitor_text else "unavailable")).strip() or "unavailable"
    return {
        "status": status,
        "generated_at": raw.get("generated_at"),
        "name_of_market": str(raw.get("name_of_market") or "").strip(),
        "original_company": original_company,
        "competitors": competitors,
        "review_markdown": competitor_text,
        "market_agent_markdown": market_agent_text,
        "error": str(raw.get("error") or "").strip(),
    }


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


def _normalize_lookup_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _extract_alias_from_nested(value: Any, normalized_aliases: List[str]) -> str:
    if isinstance(value, dict):
        for key, nested in value.items():
            key_norm = _normalize_lookup_key(str(key))
            if any(alias in key_norm or key_norm in alias for alias in normalized_aliases):
                txt = _as_readable_text(nested)
                if txt:
                    return txt
            nested_txt = _extract_alias_from_nested(nested, normalized_aliases)
            if nested_txt:
                return nested_txt
        return ""
    if isinstance(value, list):
        for nested in value:
            nested_txt = _extract_alias_from_nested(nested, normalized_aliases)
            if nested_txt:
                return nested_txt
        return ""
    return ""


def _extract_reason_by_alias(raw_json: Any, aliases: List[str]) -> str:
    if not isinstance(raw_json, dict) or not raw_json:
        return ""
    normalized_aliases = [_normalize_lookup_key(alias) for alias in aliases if str(alias or "").strip()]
    normalized_aliases = [alias for alias in normalized_aliases if alias]
    if not normalized_aliases:
        return ""

    # 1) Exact normalized top-level key match.
    for key, value in raw_json.items():
        if _normalize_lookup_key(str(key)) in normalized_aliases:
            txt = _as_readable_text(value)
            if txt:
                return txt

    # 2) Partial top-level key match for slight naming drift.
    for key, value in raw_json.items():
        key_norm = _normalize_lookup_key(str(key))
        if any(alias in key_norm or key_norm in alias for alias in normalized_aliases):
            txt = _as_readable_text(value)
            if txt:
                return txt

    # 3) Recursive reason-section path match.
    for path, text in _extract_reason_sections(raw_json):
        path_norm = _normalize_lookup_key(path)
        if any(alias in path_norm or path_norm in alias for alias in normalized_aliases):
            txt = _as_readable_text(text)
            if txt:
                return txt
    # 4) Full recursive nested alias search (handles nested step_by_step / rationale variants).
    nested_txt = _extract_alias_from_nested(raw_json, normalized_aliases)
    if nested_txt:
        return nested_txt
    return ""


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

def _normalize_probability_value(value: Any) -> Optional[float]:
    prob = _safe_float(value)
    if prob is None:
        return None
    if prob > 1.0 and prob <= 100.0:
        prob = prob / 100.0
    if prob < 0.0 or prob > 1.0:
        return None
    return float(prob)


def _scenario_entry(raw: Dict[str, Any], scenario: str) -> Any:
    if not isinstance(raw, dict):
        return None
    scenarios = raw.get("scenarios")
    if isinstance(scenarios, dict) and scenario in scenarios:
        return scenarios.get(scenario)
    return raw.get(scenario)


def _scenario_probability_from_entry(entry: Any) -> Optional[float]:
    if isinstance(entry, (list, tuple)) and len(entry) >= 1:
        return _normalize_probability_value(entry[0])
    if isinstance(entry, dict):
        return _normalize_probability_value(entry.get("probability"))
    return None


def _scenario_value_from_entry(entry: Any, idx: int) -> Optional[float]:
    if isinstance(entry, (list, tuple)) and len(entry) > idx:
        return _safe_float(entry[idx])
    if not isinstance(entry, dict):
        return None
    if idx == 0:
        return _scenario_probability_from_entry(entry)
    if idx == 1:
        target_market_cap = _safe_float(entry.get("target_market_cap"))
        if target_market_cap is not None:
            return target_market_cap
        net_income = _safe_float(entry.get("net_income_3y"))
        if net_income is not None:
            return net_income
        revenue = _safe_float(entry.get("revenue_3y"))
        if revenue is not None:
            return revenue
        activities = entry.get("activities")
        if isinstance(activities, dict) and activities:
            vals = [_safe_float(v) for v in activities.values()]
            nums = [v for v in vals if v is not None]
            if nums:
                return float(sum(nums))
    return None


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
            entry = _scenario_entry(raw, scenario)
            n = _scenario_value_from_entry(entry, idx)
            if n is not None:
                vals.append(n)
        return _mean(vals)

    def avg_weighted_scenario_value(idx: int) -> Optional[float]:
        vals: List[float] = []
        for raw in raw_list:
            weighted = 0.0
            has_any = False
            for scenario in ["bull", "base", "bear"]:
                entry = _scenario_entry(raw, scenario)
                prob = _scenario_value_from_entry(entry, 0)
                val = _scenario_value_from_entry(entry, idx)
                if prob is None or val is None:
                    continue
                weighted += float(prob) * float(val)
                has_any = True
            if has_any:
                vals.append(weighted)
        return _mean(vals)

    def coalesce(*values: Optional[float]) -> Optional[float]:
        for value in values:
            if isinstance(value, (int, float)):
                return float(value)
        return None

    def _normalize_activity_metric_key(name: str) -> str:
        normalized = re.sub(r"[^a-z0-9]+", "_", str(name or "").strip().lower())
        normalized = re.sub(r"_+", "_", normalized).strip("_")
        return normalized or "unknown_activity"

    def avg_weighted_activity_values() -> Dict[str, float]:
        collected: Dict[str, List[float]] = {}
        for raw in raw_list:
            # Preferred path: precomputed weighted activity values from backend detail payload.
            weighted_raw = raw.get("weighted_activity_market_cap")
            if isinstance(weighted_raw, dict) and weighted_raw:
                for activity_name, activity_value in weighted_raw.items():
                    value = _safe_float(activity_value)
                    if value is None:
                        continue
                    key = _normalize_activity_metric_key(str(activity_name))
                    collected.setdefault(key, []).append(float(value))
                continue

            # Fallback path: compute weighted activity values from per-scenario activity maps.
            per_raw_weighted: Dict[str, float] = {}
            for scenario in ["bull", "base", "bear"]:
                entry = _scenario_entry(raw, scenario)
                if not isinstance(entry, dict):
                    continue
                prob = _normalize_probability_value(entry.get("probability"))
                activities = entry.get("activities")
                if prob is None or not isinstance(activities, dict):
                    continue
                for activity_name, activity_value in activities.items():
                    value = _safe_float(activity_value)
                    if value is None:
                        continue
                    key = _normalize_activity_metric_key(str(activity_name))
                    per_raw_weighted[key] = float(per_raw_weighted.get(key, 0.0)) + (float(prob) * float(value))
            for key, weighted_value in per_raw_weighted.items():
                collected.setdefault(key, []).append(float(weighted_value))

        out: Dict[str, float] = {}
        for activity_key, values in collected.items():
            mean_value = _mean(values)
            if mean_value is None:
                continue
            out[f"weighted_activity_{activity_key}"] = float(mean_value)
        return out

    metrics: Dict[str, Optional[float]] = {}
    if method_name == "Scenario DCF":
        metrics = {
            "bull_probability": avg_scenario_value("bull", 0),
            "base_probability": avg_scenario_value("base", 0),
            "bear_probability": avg_scenario_value("bear", 0),
            "representative_ev_current": avg_num("representative_ev_current"),
            "fcf_next_year": avg_mid("fcf_next_year"),
            "growth_rate": avg_mid("g"),
            "wacc": avg_mid("WACC"),
            "terminal_growth": avg_mid("TERMINAL"),
        }
    elif method_name == "Target Scenario":
        metrics = {
            "bull_probability": avg_scenario_value("bull", 0),
            "base_probability": avg_scenario_value("base", 0),
            "bear_probability": avg_scenario_value("bear", 0),
            "target_market_cap": coalesce(avg_num("target_market_cap"), avg_weighted_scenario_value(1)),
        }
    elif method_name == "Earnings Scenario":
        metrics = {
            "bull_probability": avg_scenario_value("bull", 0),
            "base_probability": avg_scenario_value("base", 0),
            "bear_probability": avg_scenario_value("bear", 0),
            "net_income_3y": coalesce(avg_num("net_income_3y"), avg_weighted_scenario_value(1)),
            "pe_multiple": avg_num("pe_multiple"),
        }
    elif method_name == "Revenue Scenario":
        metrics = {
            "bull_probability": avg_scenario_value("bull", 0),
            "base_probability": avg_scenario_value("base", 0),
            "bear_probability": avg_scenario_value("bear", 0),
            "representative_ev_current": avg_num("representative_ev_current"),
            "revenue_3y": coalesce(avg_num("revenue_3y"), avg_weighted_scenario_value(1)),
            "ev_sales_multiple": avg_mid("ev_sales_multiple"),
        }
    elif method_name == "Composite Scenario":
        metrics = {
            "bull_probability": avg_scenario_value("bull", 0),
            "base_probability": avg_scenario_value("base", 0),
            "bear_probability": avg_scenario_value("bear", 0),
            "revenue_growth_3y_avg": avg_num("revenue_growth_3y_avg"),
            "operating_margin": avg_num("operating_profitability_margin"),
            "net_financing_result": avg_num("net_financing_result"),
            "tax_rate": avg_num("tax_rate"),
            "pe_multiple": avg_num("pe_multiple"),
        }
    elif method_name == "SOTP Scenario":
        metrics = {
            "bull_probability": avg_scenario_value("bull", 0),
            "base_probability": avg_scenario_value("base", 0),
            "bear_probability": avg_scenario_value("bear", 0),
            "target_market_cap": coalesce(avg_num("target_market_cap"), avg_weighted_scenario_value(1)),
        }
        for activity_metric_key, activity_metric_value in avg_weighted_activity_values().items():
            metrics[activity_metric_key] = activity_metric_value
    elif method_name == "Dream Team":
        metrics = {
            "target_market_cap": avg_num("target_market_cap"),
        }
    return {k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))}


def _deterministic_red_flags(*, price_cv: Any, lmil: Any) -> List[str]:
    flags: List[str] = []

    cv = _safe_float(price_cv)
    if cv is not None and cv > 0.6:
        flags.append("High cross-model disagreement score indicates low agreement between methods.")

    if isinstance(lmil, (list, tuple)) and len(lmil) >= 2:
        lmil_mean = _safe_float(lmil[0])
        lmil_cv = _safe_float(lmil[1])
        if lmil_cv is not None and abs(lmil_cv) > 1.25:
            flags.append("Investment-vote disagreement score is elevated (LMIL), signaling fragile conviction.")
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


def deterministic_red_flags(*, price_cv: Any, lmil: Any) -> List[str]:
    return _deterministic_red_flags(price_cv=price_cv, lmil=lmil)


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
    main_thesis_doc = {
        "company": "",
        "document_type": "main_thesis_kpis",
        "valuation_revolves_around": "",
        "main_questions": [],
        "kpis": [],
    }
    return {
        "documents": {
            "executive_summary": exec_doc,
            "bull_case": bull_doc,
            "bear_case": bear_doc,
            "main_thesis": main_thesis_doc,
        },
        "executive_summary_markdown": exec_summary,
        "bull_case_reasons": _as_str_list(bull_doc.get("reasons"), max_items=15),
        "bear_case_reasons": _as_str_list(bear_doc.get("reasons"), max_items=15),
        "main_thesis_questions": [],
        "watchlist_kpis": [],
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


def _has_exec_summary(doc: Dict[str, Any]) -> bool:
    if not isinstance(doc, dict):
        return False
    return bool(_first_non_empty(doc.get("executive_summary"), doc.get("executive_summary_markdown")))


def _has_reasons(doc: Dict[str, Any]) -> bool:
    if not isinstance(doc, dict):
        return False
    return bool(_as_str_list(doc.get("reasons"), max_items=1))


def _has_main_thesis(doc: Dict[str, Any]) -> bool:
    if not isinstance(doc, dict):
        return False
    return bool(
        _first_non_empty(doc.get("valuation_revolves_around"))
        or _as_str_list(doc.get("main_questions"), max_items=1)
        or _as_kpi_list(doc.get("kpis"), max_items=1)
    )


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
        merged_text = f"{merged_text}\n\n# SEC Summary Context\n{sec_short_text}"

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

    max_attempts_raw = os.getenv("DASHBOARD_EXTRACTION_ATTEMPTS", "").strip()
    try:
        max_attempts = int(max_attempts_raw) if max_attempts_raw else 3
    except Exception:
        max_attempts = 3
    max_attempts = max(1, max_attempts)

    exec_doc: Dict[str, Any] = {}
    bull_doc: Dict[str, Any] = {}
    bear_doc: Dict[str, Any] = {}
    main_thesis_doc: Dict[str, Any] = {}
    for _ in range(max_attempts):
        try:
            cand_exec = _run_json_extraction_prompt(
                ticker=ticker,
                financial_dict=financial_dict,
                text=merged_text,
                instruction=INSTRUCTION_EXECUTIVE_SUMMARY,
            )
            if _has_exec_summary(cand_exec):
                exec_doc = cand_exec
        except Exception:
            pass

        try:
            cand_bull = _run_json_extraction_prompt(
                ticker=ticker,
                financial_dict=financial_dict,
                text=merged_text,
                instruction=INSTRUCTION_BULL_CASE,
            )
            if _has_reasons(cand_bull):
                bull_doc = cand_bull
        except Exception:
            pass

        try:
            cand_bear = _run_json_extraction_prompt(
                ticker=ticker,
                financial_dict=financial_dict,
                text=merged_text,
                instruction=INSTRUCTION_BEAR_CASE,
            )
            if _has_reasons(cand_bear):
                bear_doc = cand_bear
        except Exception:
            pass

        try:
            cand_main_thesis = _run_json_extraction_prompt(
                ticker=ticker,
                financial_dict=financial_dict,
                text=merged_text,
                instruction=INSTRUCTION_MAIN_THESIS_KPIS,
            )
            if _has_main_thesis(cand_main_thesis):
                main_thesis_doc = cand_main_thesis
        except Exception:
            pass

        if _has_exec_summary(exec_doc) and _has_reasons(bull_doc) and _has_reasons(bear_doc) and _has_main_thesis(main_thesis_doc):
            break

    fallback = _fallback_qualitative_sections(
        analysis_text=analysis_text,
        sec_short_text=sec_short_text,
        deterministic_red_flags=deterministic_red_flags,
    )
    fallback_docs = fallback.get("documents", {}) if isinstance(fallback.get("documents"), dict) else {}

    if not _has_exec_summary(exec_doc):
        exec_doc = fallback_docs.get("executive_summary", {}) if isinstance(fallback_docs.get("executive_summary"), dict) else {}
    if not _has_reasons(bull_doc):
        bull_doc = fallback_docs.get("bull_case", {}) if isinstance(fallback_docs.get("bull_case"), dict) else {}
    if not _has_reasons(bear_doc):
        bear_doc = fallback_docs.get("bear_case", {}) if isinstance(fallback_docs.get("bear_case"), dict) else {}
    if not _has_main_thesis(main_thesis_doc):
        main_thesis_doc = fallback_docs.get("main_thesis", {}) if isinstance(fallback_docs.get("main_thesis"), dict) else {}

    bull_reasons = _as_str_list(bull_doc.get("reasons"), max_items=None)
    bear_reasons = _as_str_list(bear_doc.get("reasons"), max_items=None)
    main_questions = _as_str_list(main_thesis_doc.get("main_questions"), max_items=None)
    watchlist_kpis = _as_kpi_list(main_thesis_doc.get("kpis"), max_items=None)
    main_thesis_doc["main_questions"] = main_questions
    main_thesis_doc["kpis"] = watchlist_kpis

    executive_summary = _first_non_empty(exec_doc.get("executive_summary"), exec_doc.get("executive_summary_markdown"))
    if not executive_summary:
        executive_summary = "Executive summary extraction was empty."

    source = "llm"
    if not (_has_exec_summary(exec_doc) and _has_reasons(bull_doc) and _has_reasons(bear_doc) and _has_main_thesis(main_thesis_doc)):
        source = "mixed_fallback"

    return {
        "documents": {
            "executive_summary": exec_doc,
            "bull_case": bull_doc,
            "bear_case": bear_doc,
            "main_thesis": main_thesis_doc,
        },
        "executive_summary_markdown": executive_summary,
        "bull_case_reasons": bull_reasons,
        "bear_case_reasons": bear_reasons,
        "main_thesis_questions": main_questions,
        "watchlist_kpis": watchlist_kpis,
        "key_insights": [],
        "bull_insights": bull_reasons[:10],
        "red_flags": [],
        "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
        "source": source,
    }


def build_dashboard_appendix_text(ticker: str, qualitative: Dict[str, Any]) -> str:
    docs = qualitative.get("documents", {}) if isinstance(qualitative, dict) else {}
    exec_doc = docs.get("executive_summary", {}) if isinstance(docs.get("executive_summary"), dict) else {}
    bull_doc = docs.get("bull_case", {}) if isinstance(docs.get("bull_case"), dict) else {}
    bear_doc = docs.get("bear_case", {}) if isinstance(docs.get("bear_case"), dict) else {}
    main_thesis_doc = docs.get("main_thesis", {}) if isinstance(docs.get("main_thesis"), dict) else {}

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

    lines.extend(["", "## Main Thesis Questions"])
    valuation_revolves = _first_non_empty(main_thesis_doc.get("valuation_revolves_around"))
    if valuation_revolves:
        lines.append(valuation_revolves)
    main_questions = _as_str_list(main_thesis_doc.get("main_questions"), max_items=None)
    if not main_questions:
        main_questions = _as_str_list(qualitative.get("main_thesis_questions"), max_items=None)
    for item in main_questions:
        lines.append(f"- {item}")

    lines.extend(["", "## KPI Watchlist"])
    watchlist_kpis = _as_kpi_list(main_thesis_doc.get("kpis"), max_items=None)
    if not watchlist_kpis:
        watchlist_kpis = _as_kpi_list(qualitative.get("watchlist_kpis"), max_items=None)
    for item in watchlist_kpis:
        name = item.get("name", "").strip()
        why = item.get("why_it_matters", "").strip()
        direction = item.get("direction_to_watch", "").strip()
        detail = " ".join(part for part in [why, direction] if part).strip()
        lines.append(f"- {name}: {detail}" if name and detail else f"- {name or detail}")

    return "\n".join(lines).strip() + "\n"


def _scale_price_value(value: Any, multiplier: float) -> Optional[float]:
    n = _safe_float(value)
    if n is None:
        return None
    return float(n * multiplier)


def _resolve_model_price_multiplier(
    *,
    aggregate_targets: Mapping[str, Any],
    consensus_price: Optional[float],
    price_currency_to_usd: float,
    is_foreign: bool,
) -> float:
    # Deterministic path: convert model-level USD targets back to local trading scale
    # with the same multiplier used by the pricing pipeline.
    multiplier = _safe_float(price_currency_to_usd) or 1.0
    if not is_foreign:
        return 1.0
    if multiplier > 0 and abs(multiplier - 1.0) > 1e-9:
        return multiplier

    # Legacy fallback when FX metadata is missing: infer the scale from consensus
    # (already in local scale) vs raw per-model targets (USD scale).
    target_values: List[float] = []
    for raw in aggregate_targets.values():
        v = _safe_float(raw)
        if v is None or abs(v) < 1e-9:
            continue
        target_values.append(abs(v))
    if not target_values:
        return 1.0
    c = abs(consensus_price) if consensus_price is not None else None
    if c is None or c <= 0:
        return 1.0
    mean_target = float(sum(target_values) / len(target_values))
    if mean_target <= 0:
        return 1.0
    inferred = c / mean_target
    return inferred if inferred > 0 else 1.0


def _build_method_tab(
    *,
    method_name: str,
    items: List[Dict[str, Any]],
    method_target: Optional[float],
    method_investment: Optional[float],
    price_scale_multiplier: float = 1.0,
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
                "target_price": _scale_price_value(item.get("target_price"), price_scale_multiplier),
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


def _extract_overall_triplet(metric_dict: Dict[str, Any]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    if not isinstance(metric_dict, dict):
        return None, None, None
    overall = metric_dict.get("Overall")
    if not isinstance(overall, (list, tuple)) or not overall:
        return None, None, None
    mean_v = _safe_float(overall[0]) if len(overall) >= 1 else None
    min_v = _safe_float(overall[1]) if len(overall) >= 2 else mean_v
    max_v = _safe_float(overall[2]) if len(overall) >= 3 else mean_v
    return mean_v, min_v, max_v


def _compute_price_performance_pct(ticker: str) -> Dict[str, Optional[float]]:
    hist = None
    for attempt in range(3):
        try:
            hist = yf.Ticker(str(ticker or "").strip()).history(period="max")
        except Exception:
            hist = None
        if hist is not None and not getattr(hist, "empty", True):
            break
        if attempt < 2:
            time.sleep(2.0 * (attempt + 1))
    if hist is None or getattr(hist, "empty", True):
        return {}
    try:
        close_series = hist["Close"]
    except Exception:
        return {}
    if getattr(close_series, "empty", True):
        return {}

    last_price = _safe_float(close_series.iloc[-1])
    if last_price is None or last_price <= 0:
        return {}

    def calc_return(trading_days: int) -> Optional[float]:
        if trading_days <= 0:
            return None
        try:
            past_price = _safe_float(close_series.iloc[-trading_days - 1])
        except Exception:
            return None
        if past_price is None or past_price <= 0:
            return None
        return ((last_price / past_price) - 1.0) * 100.0

    periods = {
        "1D": 1,
        "1W": 5,
        "1M": 21,
        "3M": 63,
        "6M": 126,
        "1Y": 252,
        "3Y": 252 * 3,
        "5Y": 252 * 5,
    }
    returns: Dict[str, Optional[float]] = {}
    for label, days in periods.items():
        value = calc_return(days)
        rounded = round(value, 2) if value is not None else None
        returns[label] = _safe_float(rounded)
    return returns


def _currency_context(ticker: str, info: Mapping[str, Any]) -> Dict[str, Any]:
    original_price_currency = str(info.get("original_price_currency") or info.get("currency") or "USD").upper()
    original_financial_currency = str(info.get("original_financial_currency") or info.get("financialCurrency") or "USD").upper()
    price_currency_to_usd = _safe_float(info.get("price_currency_to_USD")) or 1.0
    financial_currency_to_usd = _safe_float(info.get("financial_currency_to_USD")) or 1.0

    is_israeli = (
        str(ticker or "").upper().endswith(".TA")
        or original_price_currency in {"ILS", "ILA"}
        or original_financial_currency in {"ILS", "ILA"}
    )
    display_currency = {
        "ILA": "ILS",  # agorot display as ILS symbol while keeping local trading scale values
        "GBP": "GBP",
        "GBX": "GBP",  # pence aliases -> GBP symbol
        "GBPX": "GBP",
        "ZAC": "ZAR",  # cents -> rand symbol
    }.get(original_price_currency, original_price_currency or "USD")
    if not display_currency:
        display_currency = "USD"
    is_foreign = str(display_currency).upper() != "USD"

    return {
        "display_currency": str(display_currency).upper(),
        "is_israeli": bool(is_israeli),
        "is_foreign": bool(is_foreign),
        "original_price_currency": original_price_currency,
        "original_financial_currency": original_financial_currency,
        "price_currency_to_usd": price_currency_to_usd,
        "financial_currency_to_usd": financial_currency_to_usd,
        # Dashboard numeric values are already emitted in local display scale.
        # Keep display multipliers at 1 to avoid UI double-conversion.
        "price_usd_to_display": 1.0,
        "financial_usd_to_display": 1.0,
        "price_unit_note": "agorot" if original_price_currency == "ILA" else None,
    }


def _build_all_values_payload(method_details: Dict[str, Any], final_dict: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
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

    # Add unified representative range rows from final_dict overall outputs.
    if isinstance(final_dict, dict):
        synthetic_rows = [
            ("representative_revenue", "Representative Revenue", final_dict.get("Revenue", {})),
            ("representative_pe", "Representative P/E", final_dict.get("P/E", {})),
            ("representative_earnings", "Representative Earnings", final_dict.get("Net Income", {})),
        ]
        for metric_key, label, metric_payload in synthetic_rows:
            mean_v, min_v, max_v = _extract_overall_triplet(metric_payload if isinstance(metric_payload, dict) else {})
            if mean_v is None and min_v is None and max_v is None:
                continue
            if mean_v is None:
                mean_v = min_v if min_v is not None else max_v
            if min_v is None:
                min_v = mean_v
            if max_v is None:
                max_v = mean_v
            if mean_v is None:
                continue
            metric_means.append(
                {
                    "metric_key": metric_key,
                    "label": label,
                    "mean": float(mean_v),
                    "min": float(min_v),
                    "max": float(max_v),
                    "sample_count": 1,
                    "method_count": 1,
                    "methods": ["Overall"],
                    "source_paths": [f"final_dict.{metric_key}.Overall"],
                }
            )

    # Add equal-weight blended scenario probabilities across scenario-capable methods.
    scenario_methods = [
        "Scenario DCF",
        "Target Scenario",
        "Earnings Scenario",
        "Revenue Scenario",
        "Composite Scenario",
        "SOTP Scenario",
    ]
    prob_buckets: Dict[str, List[float]] = {"bull": [], "base": [], "bear": []}
    for method_name in scenario_methods:
        items = method_details.get(method_name, []) if isinstance(method_details, dict) else []
        if not isinstance(items, list) or not items:
            continue
        per_method: Dict[str, List[float]] = {"bull": [], "base": [], "bear": []}
        for item in items:
            if not isinstance(item, dict):
                continue
            raw_json = _parse_raw_json_from_item(item)
            if not raw_json:
                continue
            for label in ["bull", "base", "bear"]:
                p = _scenario_probability_from_entry(_scenario_entry(raw_json, label))
                if p is not None:
                    per_method[label].append(float(p))
        for label in ["bull", "base", "bear"]:
            if per_method[label]:
                prob_buckets[label].append(float(sum(per_method[label]) / len(per_method[label])))

    blended_specs = [
        ("bull_probability_blended", "Bull Probability", prob_buckets["bull"]),
        ("base_probability_blended", "Base Probability", prob_buckets["base"]),
        ("bear_probability_blended", "Bear Probability", prob_buckets["bear"]),
    ]
    for metric_key, label, values in blended_specs:
        if not values:
            continue
        mean_v = float(sum(values) / len(values))
        metric_means.append(
            {
                "metric_key": metric_key,
                "label": label,
                "mean": mean_v,
                "min": mean_v,
                "max": mean_v,
                "sample_count": len(values),
                "method_count": len(values),
                "methods": scenario_methods,
                "source_paths": [f"blended_probabilities.{metric_key}"],
            }
        )

    metric_means.sort(key=lambda x: x["label"])
    source_values.sort(key=lambda x: (x["method"], x["metric_key"], x["persona"]))
    return {
        "metric_means": metric_means,
        "source_values": source_values,
    }


def _is_table_payload(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("columns"), list)
        and isinstance(value.get("values"), list)
    )


def _table_payload_rows(value: Any, *, max_rows: Optional[int] = None) -> List[Dict[str, Any]]:
    if not _is_table_payload(value):
        return []
    columns = [str(c) for c in value.get("columns", [])]
    indexes = [str(i) for i in value.get("index", [])] if isinstance(value.get("index"), list) else []
    values = value.get("values", [])
    rows: List[Dict[str, Any]] = []
    limit_values = values if max_rows is None else values[:max_rows]
    for idx, raw_row in enumerate(limit_values):
        if not isinstance(raw_row, list):
            continue
        row = {columns[col_idx]: raw_row[col_idx] if col_idx < len(raw_row) else None for col_idx in range(len(columns))}
        row["_index"] = indexes[idx] if idx < len(indexes) else str(idx)
        rows.append(_json_safe(row))
    return rows


def _latest_recommendation_mix(recommendations: Any) -> Dict[str, Any]:
    rows = _table_payload_rows(recommendations)
    if not rows:
        return {
            "latest": {},
            "previous": {},
            "total": 0,
            "stance_score": None,
            "buy_side_pct": None,
            "sell_side_pct": None,
            "trend": "unavailable",
        }

    def _score(row: Mapping[str, Any]) -> Tuple[float, int, float, float]:
        strong_buy = _safe_float(row.get("strongBuy")) or 0.0
        buy = _safe_float(row.get("buy")) or 0.0
        hold = _safe_float(row.get("hold")) or 0.0
        sell = _safe_float(row.get("sell")) or 0.0
        strong_sell = _safe_float(row.get("strongSell")) or 0.0
        total_f = strong_buy + buy + hold + sell + strong_sell
        if total_f <= 0:
            return 0.0, 0, 0.0, 0.0
        weighted = ((2 * strong_buy) + buy - sell - (2 * strong_sell)) / total_f
        buy_side = ((strong_buy + buy) / total_f) * 100.0
        sell_side = ((sell + strong_sell) / total_f) * 100.0
        return weighted, int(total_f), buy_side, sell_side

    latest = rows[0]
    latest_score, latest_total, buy_side, sell_side = _score(latest)
    previous = rows[1] if len(rows) > 1 else {}
    trend = "flat"
    if previous:
        previous_score, _, _, _ = _score(previous)
        delta = latest_score - previous_score
        if delta > 0.05:
            trend = "improving"
        elif delta < -0.05:
            trend = "deteriorating"
    if latest_total and buy_side >= 60:
        posture = "buy-skewed"
    elif latest_total and sell_side >= 20:
        posture = "sell-skewed"
    elif latest_total and ((_safe_float(latest.get("hold")) or 0) / latest_total) >= 0.5:
        posture = "hold-heavy"
    else:
        posture = "balanced"
    return {
        "latest": latest,
        "previous": previous,
        "total": latest_total,
        "stance_score": latest_score if latest_total else None,
        "buy_side_pct": buy_side if latest_total else None,
        "sell_side_pct": sell_side if latest_total else None,
        "trend": trend,
        "posture": posture,
    }


def _target_metrics(targets: Any) -> Dict[str, Any]:
    raw = targets if isinstance(targets, dict) else {}
    current = _safe_float(raw.get("current"))
    mean = _safe_float(raw.get("mean"))
    median = _safe_float(raw.get("median"))
    low = _safe_float(raw.get("low"))
    high = _safe_float(raw.get("high"))
    upside_pct = ((mean - current) / current) * 100.0 if mean is not None and current not in (None, 0) else None
    range_spread_pct = ((high - low) / current) * 100.0 if high is not None and low is not None and current not in (None, 0) else None
    if upside_pct is None or abs(upside_pct) <= 1e-9:
        tone = "neutral"
    else:
        tone = "up" if upside_pct > 0 else "down"
    return {
        "current": current,
        "mean": mean,
        "median": median,
        "low": low,
        "high": high,
        "upside_pct": upside_pct,
        "range_spread_pct": range_spread_pct,
        "tone": tone,
    }


def build_wall_st_payload(
    *,
    ticker: str,
    info_dict: Dict[str, Any],
    synthesis: Optional[Dict[str, Any]] = None,
    errors: Optional[List[str]] = None,
) -> Dict[str, Any]:
    raw = info_dict.get("wall_st_raw") if isinstance(info_dict, dict) else {}
    raw = raw if isinstance(raw, dict) else {}
    info = info_dict.get("info", {}) if isinstance(info_dict, dict) else {}
    info = info if isinstance(info, dict) else {}
    currency = raw.get("currency") if isinstance(raw.get("currency"), dict) else {}
    currency_context = {
        "original_price_currency": _first_non_empty(currency.get("original_price_currency"), info.get("original_price_currency"), info.get("currency"), "USD"),
        "original_financial_currency": _first_non_empty(currency.get("original_financial_currency"), info.get("original_financial_currency"), info.get("financialCurrency"), "USD"),
        "price_currency_to_USD": _safe_float(currency.get("price_currency_to_USD") or info.get("price_currency_to_USD")) or 1.0,
        "financial_currency_to_USD": _safe_float(currency.get("financial_currency_to_USD") or info.get("financial_currency_to_USD")) or 1.0,
    }
    targets = raw.get("targets") if isinstance(raw.get("targets"), dict) else {}
    recommendations = raw.get("recommendations", info_dict.get("recommendations") if isinstance(info_dict, dict) else None)
    down_upgrades = raw.get("down_upgrades", info_dict.get("down_upgrades") if isinstance(info_dict, dict) else None)
    earnings_estimate = raw.get("earnings_estimate", info_dict.get("earnings_estimate") if isinstance(info_dict, dict) else None)
    revenue_estimate = raw.get("revenue_estimate", info_dict.get("revenue_estimate") if isinstance(info_dict, dict) else None)
    rec_metrics = _latest_recommendation_mix(recommendations)
    errors_out = [str(e) for e in (errors or []) if str(e or "").strip()]
    table_count = sum(
        1
        for payload in (recommendations, down_upgrades, earnings_estimate, revenue_estimate)
        if _table_payload_rows(payload, max_rows=1)
    )
    status = "success" if targets or table_count else "unavailable"
    return {
        "status": status,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "raw": {
            "targets": _json_safe(targets),
            "recommendations": _json_safe(recommendations),
            "down_upgrades": _json_safe(down_upgrades),
            "earnings_estimate": _json_safe(earnings_estimate),
            "revenue_estimate": _json_safe(revenue_estimate),
            "num_of_analysts": int(_safe_float(raw.get("num_of_analysts", info_dict.get("num_of_analysts", 0) if isinstance(info_dict, dict) else 0)) or 0),
            "currency": currency_context,
        },
        "metrics": {
            "targets": _target_metrics(targets),
            "recommendations": rec_metrics,
            "recent_actions": _table_payload_rows(down_upgrades, max_rows=80),
            "earnings_rows": _table_payload_rows(earnings_estimate),
            "revenue_rows": _table_payload_rows(revenue_estimate),
        },
        "synthesis": synthesis if isinstance(synthesis, dict) else {"status": "unavailable", "bullets": []},
        "errors": errors_out,
    }


def generate_wall_st_synthesis(*, ticker: str, wall_st_payload: Dict[str, Any]) -> Dict[str, Any]:
    from . import legacy_port as legacy

    if not isinstance(wall_st_payload, dict) or wall_st_payload.get("status") != "success":
        return {"status": "unavailable", "bullets": []}
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        return {"status": "unavailable", "bullets": []}
    compact_payload = {
        "ticker": ticker,
        "currency": ((wall_st_payload.get("raw") or {}).get("currency") or {}),
        "targets": ((wall_st_payload.get("raw") or {}).get("targets") or {}),
        "recommendation_metrics": ((wall_st_payload.get("metrics") or {}).get("recommendations") or {}),
        "recent_actions": ((wall_st_payload.get("metrics") or {}).get("recent_actions") or [])[:20],
        "earnings_rows": ((wall_st_payload.get("metrics") or {}).get("earnings_rows") or []),
        "revenue_rows": ((wall_st_payload.get("metrics") or {}).get("revenue_rows") or []),
    }
    prompt = f"""
You are writing a dashboard-only Wall Street analyst read for {ticker}.

Use only this analyst payload. It is intentionally in original reported units, not normalized for valuation.
Do not produce a target price recommendation, portfolio recommendation, or valuation output.

Write for a busy investor scanning the dashboard:
- concise, plain English, and user friendly
- useful at a fast glance
- specific to the data, not generic
- no jargon unless the data requires it
- no long paragraphs
- each bullet should be one sentence, ideally under 24 words

Focus on:
- what the Street consensus is saying
- whether conviction is strong, split, or hold-heavy
- whether analyst actions/revisions look improving or deteriorating
- what revenue and EPS estimates imply
- any contradiction, such as bullish ratings with weak growth or target cuts

Return JSON only:
{{
  "status": "success",
  "bullets": [
    "4 to 6 concise, user-friendly bullets"
  ]
}}

Analyst payload:
{json.dumps(_json_safe(compact_payload), ensure_ascii=False)}
""".strip()
    try:
        raw = legacy.deepseek_simple_text(
            api_key=api_key,
            prompt=prompt,
            model="deepseek-chat",
            temperature=0.2,
            short_answer=False,
        )
        parsed = _parse_json_blob(raw)
        bullets = _as_str_list(parsed.get("bullets"), max_items=7)
        if bullets:
            return {"status": "success", "bullets": bullets}
    except Exception as err:
        return {"status": "error", "bullets": [], "error": str(err)[:300]}
    return {"status": "unavailable", "bullets": []}


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
    sec_qna: Optional[Dict[str, Any]] = None,
    technical_analysis: Optional[Dict[str, Any]] = None,
    trading_agents: Optional[Dict[str, Any]] = None,
    market_review: Optional[Dict[str, Any]] = None,
    wall_st: Optional[Dict[str, Any]] = None,
    analysis_duration_minutes: Optional[float] = None,
    qualitative_sections: Optional[Dict[str, Any]] = None,
    filings: Optional[Dict[str, Any]] = None,
    enable_llm_extractions: bool = True,
) -> Dict[str, Any]:
    info = info_dict.get("info", {}) if isinstance(info_dict, dict) else {}
    currency_context = _currency_context(ticker=ticker, info=info if isinstance(info, dict) else {})
    price_performance_pct = _compute_price_performance_pct(ticker)
    prices = final_dict.get("Prices", {}) if isinstance(final_dict.get("Prices"), dict) else {}
    current_price = _safe_float(prices.get("Current")) or _safe_float(variables_dict.get("price")) or 0.0
    overall = prices.get("Overall") if isinstance(prices.get("Overall"), (list, tuple)) else []
    consensus_price = _safe_float(overall[0]) if len(overall) >= 1 else None
    confidence_std = _safe_float(prices.get("STD"))
    confidence_cv = _safe_float(prices.get("CV"))
    lmil = prices.get("LMIL") if isinstance(prices.get("LMIL"), (list, tuple)) else []

    deterministic_red_flags = _deterministic_red_flags(
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
    sec_qna_payload = sec_qna if isinstance(sec_qna, dict) else {
        "status": "unavailable",
        "ticker": ticker,
        "text": "",
        "questions": [],
        "answers": [],
        "errors": [],
    }

    method_details = explain_payload.get("methods", {}) if isinstance(explain_payload, dict) else {}
    aggregate_targets = explain_payload.get("aggregate_targets", {}) if isinstance(explain_payload, dict) else {}
    aggregate_investments = explain_payload.get("aggregate_investments", {}) if isinstance(explain_payload, dict) else {}
    target_multiplier = _resolve_model_price_multiplier(
        aggregate_targets=aggregate_targets if isinstance(aggregate_targets, dict) else {},
        consensus_price=consensus_price,
        price_currency_to_usd=_safe_float(currency_context.get("price_currency_to_usd")) or 1.0,
        is_foreign=bool(currency_context.get("display_currency")) and str(currency_context.get("display_currency")).upper() != "USD",
    )
    method_order = [
        "Scenario DCF",
        "Target Scenario",
        "Earnings Scenario",
        "Revenue Scenario",
        "Composite Scenario",
        "SOTP Scenario",
        "Dream Team",
    ]

    method_blocks: List[Dict[str, Any]] = []
    method_tabs: List[Dict[str, Any]] = []
    for method_name in method_order:
        items = method_details.get(method_name, []) if isinstance(method_details, dict) else []
        raw_target_price = _safe_float(aggregate_targets.get(method_name)) if isinstance(aggregate_targets, dict) else None
        target_price = _scale_price_value(raw_target_price, target_multiplier) if raw_target_price is not None else None
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

        has_items = isinstance(items, list) and len(items) > 0
        has_target = target_price is not None
        has_investment = investment_amount is not None
        if not has_items and not has_target and not has_investment:
            # Method failed JSON extraction even after retry; skip it from dashboard tables/tabs.
            continue

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
                price_scale_multiplier=target_multiplier,
            )
        )

    all_values_payload = _build_all_values_payload(
        method_details if isinstance(method_details, dict) else {},
        final_dict if isinstance(final_dict, dict) else {},
    )

    dream_cards: List[Dict[str, Any]] = []
    for item in method_details.get("Dream Team", []) if isinstance(method_details, dict) else []:
        if not isinstance(item, dict):
            continue
        raw_json = _parse_raw_json_from_item(item)
        dream_cards.append(
            {
                "persona": str(item.get("persona", "") or "").strip(),
                "target_price": _scale_price_value(item.get("target_price"), target_multiplier),
                "target_market_cap": _safe_float(raw_json.get("target_market_cap")),
                "investment_amount": _safe_float(item.get("investment_amount")),
                "step_by_step_analysis": _extract_reason_by_alias(
                    raw_json,
                    ["step_by_step_analysis", "step_by_step", "step_analysis", "analysis_step_by_step"],
                ),
                "target_market_cap_rationale": _extract_reason_by_alias(
                    raw_json,
                    ["target_market_cap_rationale", "targetmarketcaprationale", "market_cap_rationale", "marketcaprationale"],
                ),
                "investment_rationale": _first_non_empty(
                    _extract_reason_by_alias(raw_json, ["investment_rationale", "investmentreason", "allocation_rationale"]),
                    _first_non_empty(raw_json.get("investment_rationale")),
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
    position_size_pct = (mean_investment / 100000.0) * 100.0 if mean_investment is not None else 0.0
    target_return_pct: Optional[float] = None
    if (
        consensus_price is not None
        and current_price is not None
        and abs(current_price) > 1e-9
    ):
        target_return_pct = ((consensus_price - current_price) / current_price) * 100.0

    if target_return_pct is not None:
        combined_score = (0.4 * position_size_pct) + (0.6 * target_return_pct)
    else:
        combined_score = position_size_pct

    cv_values: List[float] = []
    if confidence_cv is not None:
        cv_values.append(abs(float(confidence_cv)))
    if isinstance(lmil, (list, tuple)) and len(lmil) >= 2:
        lmil_cv = _safe_float(lmil[1])
        if lmil_cv is not None:
            cv_values.append(abs(float(lmil_cv)))
    overall_cv = (sum(cv_values) / len(cv_values)) if cv_values else 0.0
    misaligned_signal = (
        target_return_pct is not None
        and abs(position_size_pct) > 1e-9
        and abs(target_return_pct) > 1e-9
        and (position_size_pct * target_return_pct) < 0
    )
    if misaligned_signal:
        overall_cv *= 1.5
    confidence_factor = 1.0 / (1.0 + (overall_cv ** 1.3))
    adjusted_score = combined_score * confidence_factor

    return {
        "dashboard_version": "v2",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "analysis_duration_minutes": analysis_duration_minutes,
        "ticker": ticker,
        "header": {
            "company_name": _first_non_empty(info.get("shortName"), info.get("longName"), ticker),
            "current_price": current_price,
            "market_cap": _safe_float(variables_dict.get("market_cap")),
            "shares_outstanding": _safe_float(variables_dict.get("shares_outstanding")),
            "currency": _first_non_empty(info.get("currency"), "USD"),
            "display_currency": currency_context.get("display_currency"),
            "is_israeli": currency_context.get("is_israeli"),
            "original_price_currency": currency_context.get("original_price_currency"),
            "original_financial_currency": currency_context.get("original_financial_currency"),
            "price_currency_to_usd": currency_context.get("price_currency_to_usd"),
            "financial_currency_to_usd": currency_context.get("financial_currency_to_usd"),
            "price_usd_to_display": currency_context.get("price_usd_to_display"),
            "financial_usd_to_display": currency_context.get("financial_usd_to_display"),
            "price_unit_note": currency_context.get("price_unit_note"),
            "price_performance_pct": price_performance_pct,
        },
        "red_flag_shield": _as_str_list(qualitative.get("bear_case_reasons"), max_items=5),
        "analysis_matrix": {
            "executive_summary_markdown": qualitative.get("executive_summary_markdown", ""),
            "bull_case_reasons": qualitative.get("bull_case_reasons", []),
            "bear_case_reasons": qualitative.get("bear_case_reasons", []),
            "main_thesis_questions": qualitative.get("main_thesis_questions", []),
            "watchlist_kpis": qualitative.get("watchlist_kpis", []),
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
        "score_card": {
            "position_size_pct_of_notional": position_size_pct,
            "target_return_pct": target_return_pct,
            "combined_score": combined_score,
            "overall_cv": overall_cv,
            "confidence_factor": confidence_factor,
            "adjusted_score": adjusted_score,
            "mean_investment_amount": mean_investment,
            "rationale": "Score blends 40% investment allocation and 60% target-return, then applies disagreement confidence scaling (with extra disagreement penalty when allocation and target-direction are misaligned).",
        },
        "technical_analysis": technical_analysis if isinstance(technical_analysis, dict) else {},
        "trading_agents": trading_agents if isinstance(trading_agents, dict) else {},
        "market_review": _normalize_market_review_payload(market_review, analysis_text=analysis_text),
        "wall_st": wall_st if isinstance(wall_st, dict) else build_wall_st_payload(ticker=ticker, info_dict=info_dict),
        "sec_qna": sec_qna_payload,
        "filings": filings if isinstance(filings, dict) else {},
        "artifacts": artifacts,
    }


def write_dashboard_payload(path: str | Path, payload: Dict[str, Any]) -> str:
    target = Path(path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    clean_payload = _json_safe(payload)
    target.write_text(json.dumps(clean_payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    return str(target)
