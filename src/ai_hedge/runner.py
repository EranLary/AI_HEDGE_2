from __future__ import annotations

import os
import shutil
import sys
import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .dashboard import (
    _extract_analysis_section,
    build_dashboard_appendix_text,
    build_dashboard_payload,
    build_wall_st_payload,
    deterministic_red_flags,
    generate_wall_st_synthesis,
    generate_dashboard_sections,
    write_dashboard_payload,
)
from .io import get_artifact_store

def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        val = int(raw)
        return val if val > 0 else default
    except Exception:
        return default


# Valuation runs as a single combined-context pass.
DEFAULT_VALUATION_ITERATIONS = 1
DEFAULT_ANALYSIS_WORKERS = _env_int("ANALYSIS_WORKERS", 8)
DEFAULT_LLM_WORKERS = _env_int("LLM_WORKERS", 8)
DEFAULT_VALUATION_BLOCK_WORKERS = _env_int("VALUATION_BLOCK_WORKERS", 8)


@dataclass
class RunArtifacts:
    ticker: str
    output_dir: str
    analysis_txt: str
    prices_plot: str
    revenue_plot: str
    net_income_plot: str
    analysis_pdf: str
    prices_explain_txt: str
    prices_explain_pdf: str
    combined_pdf: str
    dashboard_json: str
    trading_agents_json: str
    trading_agents_txt: str
    market_review_json: str
    financials_json: str
    notes: List[str]
    current_revenue: Optional[float]
    target_revenue: Optional[float]
    current_earnings: Optional[float]
    target_earnings: Optional[float]
    sec_fallback_used: bool
    sec_fallback_message: str
    r2_keys: Optional[Dict[str, str]] = None


def _combine_pdf_artifacts(pdf_paths: List[Optional[Path]], output_pdf: Path) -> str:
    existing = [Path(p) for p in pdf_paths if p and Path(p).exists()]
    if not existing:
        return ""

    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for pdf_path in existing:
        reader = PdfReader(str(pdf_path))
        for page in reader.pages:
            writer.add_page(page)

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    with output_pdf.open("wb") as f:
        writer.write(f)
    return str(output_pdf.resolve()) if output_pdf.exists() else ""



def _require_api_key() -> None:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        env_path = Path(__file__).resolve().parents[2] / ".env"
        if env_path.exists():
            for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() != "DEEPSEEK_API_KEY":
                    continue
                api_key = value.strip().strip('"').strip("'").strip()
                if api_key:
                    os.environ["DEEPSEEK_API_KEY"] = api_key
                break
    if not api_key:
        raise RuntimeError("Missing DEEPSEEK_API_KEY environment variable")



def _append_progress(progress_file: Optional[str], message: str) -> None:
    if not progress_file:
        return
    try:
        path = Path(progress_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(f"{message.strip()}\n")
    except Exception:
        pass


def _attach_market_agent_markdown(
    *,
    payload: Dict[str, Any],
    analysis_text: str,
    out_dir: Path,
    ticker: str,
    market_review_json: str = "",
) -> tuple[Dict[str, Any], str]:
    raw = payload if isinstance(payload, dict) else {}
    market_agent_text = _extract_analysis_section(analysis_text, "Market Analysis")
    if market_agent_text:
        raw["market_agent_markdown"] = market_agent_text
        raw.setdefault("status", "success")
        raw.setdefault("ticker", ticker.upper().strip())

    if not raw:
        return raw, market_review_json

    target = Path(market_review_json) if market_review_json else out_dir / f"{ticker}_market_review.json"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(raw, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        return raw, str(target.resolve())
    except Exception:
        return raw, market_review_json


def _first_float(value) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _format_sec_sources(files_dict: Optional[Dict[str, object]]) -> str:
    if not isinstance(files_dict, dict):
        return "No SEC filings available."

    entries: List[str] = []
    for form_type, raw in files_dict.items():
        if not isinstance(raw, dict):
            continue
        filing_text = str(raw.get("text", "") or "").strip()
        if not filing_text:
            continue
        label = str(form_type or "").strip() or "Unknown form"
        date = str(raw.get("date", "") or "").strip()
        if date:
            entries.append(f"{label} ({date})")
        else:
            entries.append(label)

    if not entries:
        return "No SEC filings available."
    return ", ".join(entries)


def _build_sec_currency_clarification(info_dict: Optional[Dict[str, Any]]) -> str:
    info = info_dict.get("info", {}) if isinstance(info_dict, dict) else {}
    if not isinstance(info, dict):
        return ""

    original_currency = str(
        info.get("original_financial_currency")
        or info.get("financialCurrency")
        or info.get("financial_currency")
        or ""
    ).strip().upper()
    if not original_currency or original_currency == "USD":
        return ""

    conversion_ratio = _first_float(
        info.get("financial_currency_to_USD")
        or info.get("financial_currency_to_usd")
        or info.get("financialCurrencyToUSD")
    )
    if conversion_ratio is not None and conversion_ratio > 0:
        ratio_text = f"{conversion_ratio:g} {original_currency} per USD"
        conversion_text = (
            f"those original {original_currency} amounts are divided by {ratio_text} "
            "to express them in USD"
        )
    else:
        conversion_text = (
            "they are converted to USD with the available financial-currency conversion rate"
        )

    return (
        "### Currency Clarification for Valuation\n\n"
        f"Many financial figures in the SEC/MAYA filing summary above may still be stated in "
        f"{original_currency}, the company's original financial reporting currency. "
        f"The structured annual and quarterly financial tables used by the valuators are USD-converted: "
        f"{conversion_text}. When comparing filing-summary numbers with the converted tables, "
        "check the units before drawing a valuation conclusion."
    )


def _filing_source_label(form_type: str, raw: Dict[str, Any]) -> str:
    explicit = str(raw.get("source", "") or "").strip().upper()
    if explicit in {"SEC", "MAYA"}:
        return explicit
    if str(form_type or "").strip().upper().startswith("MAYA"):
        return "MAYA"
    return "SEC"


def _safe_filing_date(value: Any) -> datetime:
    txt = str(value or "").strip()
    if not txt:
        return datetime.min
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(txt[:19], fmt)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(txt.replace("Z", "+00:00"))
    except Exception:
        return datetime.min


def _normalize_filing_source_url(raw_url: Any, source: str) -> str:
    url = str(raw_url or "").strip()
    if not url:
        return ""
    if url.startswith("//"):
        return f"https:{url}"
    if url.lower().startswith(("http://", "https://")):
        return url

    source_u = str(source or "").strip().upper()
    if source_u == "MAYA":
        if url.startswith("/"):
            if "/reports/" in url or "/api/" in url:
                return f"https://maya.tase.co.il{url}"
            return f"https://mayafiles.tase.co.il{url}"
        return f"https://mayafiles.tase.co.il/{url.lstrip('/')}"

    if "." in url and "/" in url:
        return f"https://{url.lstrip('/')}"
    return url


def _filing_kind(form_type: str, raw: Dict[str, Any]) -> str:
    joined = " ".join(
        [
            str(form_type or ""),
            str(raw.get("form_type") or ""),
            str(raw.get("title") or ""),
            str(raw.get("name") or ""),
            str(raw.get("label") or ""),
        ]
    ).upper()
    if any(x in joined for x in ("10-K", "20-F", "ANNUAL", "MAYA ANNUAL")):
        return "annual"
    if any(x in joined for x in ("10-Q", "6-K", "QUARTER", "Q1", "Q2", "Q3", "Q4", "MAYA QUARTERLY")):
        return "quarterly"
    return "other"


def _empty_filing_for_dashboard() -> Dict[str, Any]:
    return {"available": False, "source": "", "form_type": "", "date": "", "source_url": ""}


def _extract_latest_filing_sources(files_dict: Optional[Dict[str, object]]) -> Dict[str, Any]:
    out = {
        "annual": _empty_filing_for_dashboard(),
        "quarterly": _empty_filing_for_dashboard(),
    }
    if not isinstance(files_dict, dict):
        return out

    rows: List[Dict[str, Any]] = []
    for form_type, raw in files_dict.items():
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text", "") or "").strip()
        if not text:
            continue
        source = _filing_source_label(str(form_type or ""), raw)
        rows.append(
            {
                "kind": _filing_kind(str(form_type or ""), raw),
                "source": source,
                "form_type": str(raw.get("form_type") or form_type or "").strip(),
                "date": str(raw.get("date") or "").strip(),
                "source_url": _normalize_filing_source_url(
                    raw.get("url") or raw.get("source_url") or raw.get("link") or raw.get("href"),
                    source,
                ),
            }
        )

    rows.sort(key=lambda x: _safe_filing_date(x.get("date")), reverse=True)
    for kind in ("annual", "quarterly"):
        picked = next((row for row in rows if row.get("kind") == kind), None)
        if not picked:
            continue
        out[kind] = {
            "available": True,
            "source": str(picked.get("source") or ""),
            "form_type": str(picked.get("form_type") or ""),
            "date": str(picked.get("date") or ""),
            "source_url": str(picked.get("source_url") or ""),
        }
    return out


def _build_sec_sources_footer(files_dict: Optional[Dict[str, object]]) -> str:
    if not _has_filing_text(files_dict):
        return ""

    sources: List[str] = []
    annual_date = ""
    quarterly_date = ""

    if isinstance(files_dict, dict):
        for form_type, raw in files_dict.items():
            if not isinstance(raw, dict):
                continue
            if not str(raw.get("text", "") or "").strip():
                continue

            source = _filing_source_label(str(form_type or ""), raw)
            if source not in sources:
                sources.append(source)

            date = str(raw.get("date", "") or "").strip()
            form_u = str(form_type or "").strip().upper()
            title_u = str(raw.get("title", "") or "").strip().upper()

            if not annual_date:
                if "MAYA ANNUAL" in form_u or "10-K" in form_u or "20-F" in form_u or "ANNUAL" in title_u:
                    annual_date = date

            if not quarterly_date:
                if "MAYA QUARTERLY" in form_u or "10-Q" in form_u or "6-K" in form_u or "QUARTER" in title_u or "Q1" in title_u or "Q2" in title_u or "Q3" in title_u or "Q4" in title_u:
                    quarterly_date = date

    if not sources:
        return ""

    source_label = ", ".join(sources)
    annual_out = annual_date or "Not available"
    quarterly_out = quarterly_date or "Not available"
    lines = [
        "## SEC Section Sources",
        f"- Source: {source_label}",
        f"- Annual report date: {annual_out}",
        f"- Quarterly report date: {quarterly_out}",
    ]
    return "\n".join(lines).strip()


def _has_filing_text(files_dict: Optional[Dict[str, object]]) -> bool:
    if not isinstance(files_dict, dict):
        return False
    for raw in files_dict.values():
        if not isinstance(raw, dict):
            continue
        if str(raw.get("text", "") or "").strip():
            return True
    return False


def _merge_unique_lines(base: List[str], extra: List[str], limit: int = 12) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in list(base or []) + list(extra or []):
        txt = str(raw or "").strip()
        if not txt:
            continue
        key = txt.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(txt)
        if len(out) >= limit:
            break
    return out


def _fmt_money(value: Any) -> str:
    try:
        return f"${float(value):,.2f}"
    except Exception:
        return "N/A"


def _fmt_number(value: Any, decimals: int = 4) -> str:
    try:
        num = float(value)
    except Exception:
        return "N/A"
    if abs(num) >= 1000:
        return f"{num:,.2f}"
    return f"{num:.{decimals}f}"


def _fmt_signed_pct(value: Any, decimals: int = 2) -> str:
    try:
        num = float(value)
    except Exception:
        return "N/A"
    if abs(num) < 1e-9:
        return f"{0:.{decimals}f}%"
    return f"{num:+.{decimals}f}%"


def _fmt_pct(value: Any, decimals: int = 2) -> str:
    try:
        num = float(value) * 100.0
    except Exception:
        return "N/A"
    if abs(num) < 1e-9:
        return f"{0:.{decimals}f}%"
    return f"{num:.{decimals}f}%"


def _currency_symbol(currency_code: Any) -> str:
    code = str(currency_code or "").strip().upper()
    if code == "ILS":
        return "₪"
    if code == "USD":
        return "$"
    if code:
        return f"{code} "
    return "$"


def _fmt_price(value: Any, currency_code: Any) -> str:
    try:
        num = float(value)
    except Exception:
        return "N/A"
    symbol = _currency_symbol(currency_code)
    if symbol.endswith(" "):
        return f"{num:,.2f} {symbol.strip()}"
    return f"{symbol}{num:,.2f}"


def _build_dashboard_signal_snapshot_text(dashboard_payload: Dict[str, Any]) -> str:
    if not isinstance(dashboard_payload, dict):
        return ""

    header = dashboard_payload.get("header") or {}
    valuation_hub = dashboard_payload.get("valuation_hub") or {}
    consensus = valuation_hub.get("consensus") or {}
    score_card = dashboard_payload.get("score_card") or dashboard_payload.get("decision_card") or {}
    currency_code = header.get("display_currency") or header.get("currency") or "USD"

    current_price = _first_float(consensus.get("current_price"))
    mean_target_price = _first_float(consensus.get("mean_target_price"))

    target_change_pct = _first_float(score_card.get("target_return_pct"))
    if (
        target_change_pct is None
        and current_price is not None
        and mean_target_price is not None
        and abs(current_price) > 1e-9
    ):
        target_change_pct = ((mean_target_price - current_price) / current_price) * 100.0

    investment_pct = _first_float(score_card.get("position_size_pct_of_notional"))

    disagreement_score = _first_float(score_card.get("overall_cv"))
    if disagreement_score is None:
        cv_vals: List[float] = []
        price_cv = _first_float(consensus.get("cv"))
        if price_cv is not None:
            cv_vals.append(abs(price_cv))
        lmil = consensus.get("lmil")
        if isinstance(lmil, (list, tuple)) and len(lmil) >= 2:
            lmil_cv = _first_float(lmil[1])
            if lmil_cv is not None:
                cv_vals.append(abs(lmil_cv))
        if cv_vals:
            disagreement_score = sum(cv_vals) / len(cv_vals)

    lines = [
        "## Dashboard Signal Snapshot",
        f"- Mean Target Price: {_fmt_price(mean_target_price, currency_code)}",
        f"- Change vs Current Price: {_fmt_signed_pct(target_change_pct)}",
        f"- Investment Sizing (% of Notional): {_fmt_signed_pct(investment_pct)}",
        f"- Disagreement Score: {_fmt_number(disagreement_score, decimals=4)}",
    ]
    return "\n".join(lines).strip()


def _upsert_dashboard_signal_snapshot_section(text: str, snapshot_section: str) -> str:
    body = str(text or "").strip()
    snap = str(snapshot_section or "").strip()
    if not snap:
        return body
    marker = "## Dashboard Signal Snapshot"
    if marker in body:
        body = body.split(marker, 1)[0].rstrip()
    if body:
        return f"{body}\n\n---\n\n{snap}\n"
    return f"{snap}\n"


def _upsert_markdown_block(text: str, marker: str, block: str) -> str:
    body = str(text or "").strip()
    marker_txt = str(marker or "").strip()
    block_txt = str(block or "").strip()
    if not marker_txt or not block_txt:
        return body
    if marker_txt in body:
        body = body.split(marker_txt, 1)[0].rstrip()
    if body:
        return f"{body}\n\n---\n\n{block_txt}\n"
    return f"{block_txt}\n"


def _wall_st_synthesis_to_markdown(wall_st_payload: Dict[str, Any]) -> str:
    synthesis = wall_st_payload.get("synthesis") if isinstance(wall_st_payload, dict) else {}
    synthesis = synthesis if isinstance(synthesis, dict) else {}
    bullets = synthesis.get("bullets") if isinstance(synthesis.get("bullets"), list) else []
    clean_bullets = [str(item or "").strip() for item in bullets if str(item or "").strip()]
    if not clean_bullets:
        return ""
    lines = [
        "## Wall ST Analyst Read",
        "",
        "This section summarizes Wall Street analyst data after valuation is complete. It is not part of the valuation prompt context.",
        "",
    ]
    lines.extend(f"- {item}" for item in clean_bullets[:6])
    return "\n".join(lines).strip()


def _extract_overall_triplet(final_dict: Dict[str, Any], metric_key: str) -> Optional[tuple[float, float, float]]:
    if not isinstance(final_dict, dict):
        return None
    payload = final_dict.get(metric_key, {})
    if not isinstance(payload, dict):
        return None
    overall = payload.get("Overall")
    if not isinstance(overall, (list, tuple)) or not overall:
        return None
    mean_v = _first_float(overall[0]) if len(overall) >= 1 else None
    min_v = _first_float(overall[1]) if len(overall) >= 2 else mean_v
    max_v = _first_float(overall[2]) if len(overall) >= 3 else mean_v
    if mean_v is None and min_v is None and max_v is None:
        return None
    if mean_v is None:
        mean_v = min_v if min_v is not None else max_v
    if min_v is None:
        min_v = mean_v
    if max_v is None:
        max_v = mean_v
    if mean_v is None or min_v is None or max_v is None:
        return None
    return float(mean_v), float(min_v), float(max_v)


def _build_assumptions_pack_text(final_dict: Dict[str, Any], explain_payload: Optional[Dict[str, Any]] = None) -> str:
    specs = [
        ("Representative Revenue", "Revenue"),
        ("Representative Earnings", "Net Income"),
        ("Representative P/E", "P/E"),
    ]
    lines: List[str] = []
    for label, key in specs:
        triplet = _extract_overall_triplet(final_dict, key)
        if not triplet:
            continue
        mean_v, min_v, max_v = triplet
        lines.append(
            f"- {label} (Mean/Min/Max): "
            f"{_fmt_number(mean_v)} / {_fmt_number(min_v)} / {_fmt_number(max_v)}"
        )

    methods = explain_payload.get("methods", {}) if isinstance(explain_payload, dict) else {}
    scenario_dcf_items = methods.get("Scenario DCF", []) if isinstance(methods, dict) else []
    dcf_assumption_items: List[Dict[str, Any]] = []
    if isinstance(scenario_dcf_items, list):
        dcf_assumption_items.extend(item for item in scenario_dcf_items if isinstance(item, dict))

    if dcf_assumption_items or isinstance(methods, dict):
        weighted_fcf_vals: List[float] = []
        weighted_g_vals: List[float] = []
        weighted_wacc_vals: List[float] = []
        weighted_terminal_vals: List[float] = []

        def _parse_raw(item: Dict[str, Any]) -> Dict[str, Any]:
            raw = item.get("raw_json", {})
            if isinstance(raw, dict) and raw:
                return raw
            txt = str(item.get("raw_json_text", "") or "").strip()
            if txt.startswith("{") and txt.endswith("}"):
                try:
                    parsed = json.loads(txt)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    return {}
            return {}

        def _mid(v: Any) -> Optional[float]:
            if isinstance(v, (list, tuple)) and len(v) >= 2:
                a = _first_float(v[0])
                b = _first_float(v[1])
                if a is not None and b is not None:
                    return (float(a) + float(b)) / 2.0
            n = _first_float(v)
            return float(n) if n is not None else None

        for item in dcf_assumption_items:
            raw = _parse_raw(item)
            if not raw:
                continue

            fcf_mid = _mid(raw.get("fcf_next_year"))
            g_mid = _mid(raw.get("g"))
            wacc_mid = _mid(raw.get("WACC"))
            terminal_mid = _mid(raw.get("TERMINAL"))
            if fcf_mid is not None:
                weighted_fcf_vals.append(fcf_mid)
            if g_mid is not None:
                weighted_g_vals.append(g_mid)
            if wacc_mid is not None:
                weighted_wacc_vals.append(wacc_mid)
            if terminal_mid is not None:
                weighted_terminal_vals.append(terminal_mid)

        def _avg(vals: List[float]) -> Optional[float]:
            if not vals:
                return None
            return float(sum(vals) / len(vals))

        def _normalized_prob(value: Any) -> Optional[float]:
            p = _first_float(value)
            if p is None:
                return None
            if p > 1.0 and p <= 100.0:
                p = p / 100.0
            if p < 0.0 or p > 1.0:
                return None
            return float(p)

        def _scenario_entry(raw: Dict[str, Any], label: str) -> Any:
            scenarios = raw.get("scenarios")
            if isinstance(scenarios, dict) and label in scenarios:
                return scenarios.get(label)
            return raw.get(label)

        def _scenario_probability(raw: Dict[str, Any], label: str) -> Optional[float]:
            entry = _scenario_entry(raw, label)
            if isinstance(entry, (list, tuple)) and len(entry) >= 1:
                return _normalized_prob(entry[0])
            if isinstance(entry, dict):
                return _normalized_prob(entry.get("probability"))
            return None

        scenario_methods = [
            "Scenario DCF",
            "Target Scenario",
            "Earnings Scenario",
            "Revenue Scenario",
            "Composite Scenario",
            "SOTP Scenario",
        ]
        blended_prob_values: Dict[str, List[float]] = {"bull": [], "base": [], "bear": []}
        for method_name in scenario_methods:
            raw_items = methods.get(method_name, []) if isinstance(methods, dict) else []
            if not isinstance(raw_items, list) or not raw_items:
                continue
            per_method_probs: Dict[str, List[float]] = {"bull": [], "base": [], "bear": []}
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                raw = _parse_raw(item)
                if not raw:
                    continue
                for label in ["bull", "base", "bear"]:
                    p = _scenario_probability(raw, label)
                    if p is not None:
                        per_method_probs[label].append(float(p))
            for label in ["bull", "base", "bear"]:
                if per_method_probs[label]:
                    method_mean = _avg(per_method_probs[label])
                    if method_mean is not None:
                        blended_prob_values[label].append(method_mean)

        scenario_lines = [
            ("Bull Probability", _avg(blended_prob_values["bull"]), "pct"),
            ("Base Probability", _avg(blended_prob_values["base"]), "pct"),
            ("Bear Probability", _avg(blended_prob_values["bear"]), "pct"),
            ("Growth Rate (G) [Scenario DCF]", _avg(weighted_g_vals), "pct"),
            ("Representative FCF [Scenario DCF]", _avg(weighted_fcf_vals), "num"),
            ("Terminal Value Growth [Scenario DCF]", _avg(weighted_terminal_vals), "pct"),
            ("WACC [Scenario DCF]", _avg(weighted_wacc_vals), "pct"),
        ]
        for label, value, kind in scenario_lines:
            if value is None:
                continue
            if kind == "pct":
                lines.append(f"- {label}: {_fmt_pct(value)}")
            else:
                lines.append(f"- {label}: {_fmt_number(value)}")
    return "\n".join(lines).strip()


def _collect_investments_from_methods(methods: Dict[str, Any]) -> List[float]:
    out: List[float] = []
    if not isinstance(methods, dict):
        return out
    for items in methods.values():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            raw = item.get("investment_amount")
            try:
                val = float(raw)
            except Exception:
                continue
            if -100000.0 <= val <= 100000.0:
                out.append(val)
    return out


def _raw_json_dict_for_item(item: Dict[str, Any]) -> Dict[str, Any]:
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


def _is_reason_key(key: str) -> bool:
    key_l = str(key).strip().lower()
    return key_l == "step_by_step_analysis" or "rationale" in key_l or "reason" in key_l


def _extract_numeric_pairs(value: Any, prefix: str = "") -> List[tuple[str, str]]:
    pairs: List[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            key_s = str(key)
            if _is_reason_key(key_s):
                continue
            child_prefix = f"{prefix}.{key_s}" if prefix else key_s
            pairs.extend(_extract_numeric_pairs(nested, child_prefix))
        return pairs
    if isinstance(value, list):
        for idx, nested in enumerate(value):
            child_prefix = f"{prefix}[{idx}]"
            pairs.extend(_extract_numeric_pairs(nested, child_prefix))
        return pairs
    if isinstance(value, bool):
        return pairs
    if isinstance(value, (int, float)):
        label = prefix or "value"
        pairs.append((label, str(value)))
    return pairs


def _humanize_numeric_key(path: str) -> str:
    text = str(path or "").strip()
    if not text:
        return "Value"
    text = text.replace("_", " ").replace(".", " > ")
    text = text.replace("[", " #").replace("]", "")
    return " ".join(part for part in text.split() if part).strip()


def _numeric_text(value: Any, *, pct: bool = False) -> str:
    num = _first_float(value)
    if num is None:
        return "N/A"
    if pct:
        return _fmt_pct(num)
    return _fmt_number(num)


def _range_mid(value: Any) -> Optional[float]:
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        a = _first_float(value[0])
        b = _first_float(value[1])
        if a is not None and b is not None:
            return (float(a) + float(b)) / 2.0
    return _first_float(value)


def _scenario_list_value(raw_json: Dict[str, Any], scenario_name: str, idx: int) -> Optional[float]:
    entry = raw_json.get(scenario_name)
    if isinstance(entry, (list, tuple)) and len(entry) > idx:
        return _first_float(entry[idx])
    if isinstance(entry, dict):
        if idx == 0:
            return _first_float(entry.get("probability"))
        if idx == 1:
            return _first_float(entry.get("target_market_cap"))
    return None


def _method_specific_numeric_pairs(method_name: str, raw_json: Dict[str, Any]) -> List[tuple[str, str]]:
    if not isinstance(raw_json, dict) or not raw_json:
        return []

    pairs: List[tuple[str, str]] = []
    scenario_labels = [("bull", "Bull"), ("base", "Base"), ("bear", "Bear")]

    if method_name == "Scenario DCF":
        for key, label in scenario_labels:
            pairs.append((f"{label} Probability", _numeric_text(_scenario_list_value(raw_json, key, 0), pct=True)))
            pairs.append((f"{label} FCF Next Year", _numeric_text(_scenario_list_value(raw_json, key, 1))))
            pairs.append((f"{label} Growth Rate (G)", _numeric_text(_scenario_list_value(raw_json, key, 2), pct=True)))
            pairs.append((f"{label} WACC", _numeric_text(_scenario_list_value(raw_json, key, 3), pct=True)))
            pairs.append((f"{label} Terminal Growth", _numeric_text(_scenario_list_value(raw_json, key, 4), pct=True)))
        pairs.append(("Representative EV (Current Anchor)", _numeric_text(raw_json.get("representative_ev_current"))))
        pairs.append(("Weighted FCF Next Year", _numeric_text(_range_mid(raw_json.get("fcf_next_year")))))
        pairs.append(("Weighted Growth Rate (G)", _numeric_text(_range_mid(raw_json.get("g")), pct=True)))
        pairs.append(("Weighted WACC", _numeric_text(_range_mid(raw_json.get("WACC")), pct=True)))
        pairs.append(("Weighted Terminal Growth", _numeric_text(_range_mid(raw_json.get("TERMINAL")), pct=True)))
    elif method_name == "Target Scenario":
        for key, label in scenario_labels:
            pairs.append((f"{label} Probability", _numeric_text(_scenario_list_value(raw_json, key, 0), pct=True)))
            pairs.append((f"{label} Target Market Cap", _numeric_text(_scenario_list_value(raw_json, key, 1))))
        pairs.append(("Weighted Target Market Cap", _numeric_text(raw_json.get("target_market_cap"))))
    elif method_name == "Earnings Scenario":
        for key, label in scenario_labels:
            pairs.append((f"{label} Probability", _numeric_text(_scenario_list_value(raw_json, key, 0), pct=True)))
            pairs.append((f"{label} Net Income (3Y)", _numeric_text(_scenario_list_value(raw_json, key, 1))))
        pairs.append(("Weighted Net Income (3Y)", _numeric_text(raw_json.get("net_income_3y"))))
        pairs.append(("P/E Multiple", _numeric_text(raw_json.get("pe_multiple"))))
    elif method_name == "Revenue Scenario":
        for key, label in scenario_labels:
            pairs.append((f"{label} Probability", _numeric_text(_scenario_list_value(raw_json, key, 0), pct=True)))
            pairs.append((f"{label} Revenue (3Y)", _numeric_text(_scenario_list_value(raw_json, key, 1))))
        pairs.append(("Representative EV (Current Anchor)", _numeric_text(raw_json.get("representative_ev_current"))))
        pairs.append(("Weighted Revenue (3Y)", _numeric_text(raw_json.get("revenue_3y"))))
        pairs.append(("EV/Sales Multiple", _numeric_text(_range_mid(raw_json.get("ev_sales_multiple")))))
    elif method_name == "Composite Scenario":
        for key, label in scenario_labels:
            pairs.append((f"{label} Probability", _numeric_text(_scenario_list_value(raw_json, key, 0), pct=True)))
            pairs.append((f"{label} Revenue Growth (3Y Avg)", _numeric_text(_scenario_list_value(raw_json, key, 1), pct=True)))
            pairs.append((f"{label} Operating Margin", _numeric_text(_scenario_list_value(raw_json, key, 2), pct=True)))
            pairs.append((f"{label} Net Financing Result", _numeric_text(_scenario_list_value(raw_json, key, 3))))
            pairs.append((f"{label} Tax Rate", _numeric_text(_scenario_list_value(raw_json, key, 4), pct=True)))
            pairs.append((f"{label} P/E Multiple", _numeric_text(_scenario_list_value(raw_json, key, 5))))
        pairs.append(("Representative Revenue (Current Year Anchor)", _numeric_text(raw_json.get("representative_revenue_current_year"))))
        pairs.append(("Weighted Revenue (3Y)", _numeric_text(raw_json.get("revenue_3y"))))
        pairs.append(("Weighted Net Income (3Y)", _numeric_text(raw_json.get("net_income_3y"))))
        pairs.append(("Weighted Revenue Growth (3Y Avg)", _numeric_text(raw_json.get("revenue_growth_3y_avg"), pct=True)))
        pairs.append(("Weighted Operating Margin", _numeric_text(raw_json.get("operating_profitability_margin"), pct=True)))
        pairs.append(("Weighted Net Financing Result", _numeric_text(raw_json.get("net_financing_result"))))
        pairs.append(("Weighted Tax Rate", _numeric_text(raw_json.get("tax_rate"), pct=True)))
        pairs.append(("Weighted P/E Multiple", _numeric_text(raw_json.get("pe_multiple"))))
    elif method_name == "SOTP Scenario":
        for key, label in scenario_labels:
            entry = raw_json.get(key)
            if isinstance(entry, dict):
                pairs.append((f"{label} Probability", _numeric_text(entry.get("probability"), pct=True)))
                pairs.append((f"{label} Target Market Cap", _numeric_text(entry.get("target_market_cap"))))
                activities = entry.get("activities", {})
                if isinstance(activities, dict):
                    for activity_name, activity_value in activities.items():
                        pairs.append((f"{label} Activity Market Cap - {activity_name}", _numeric_text(activity_value)))
        pairs.append(("Weighted Target Market Cap", _numeric_text(raw_json.get("target_market_cap"))))
        weighted_activities = raw_json.get("weighted_activity_market_cap", {})
        if isinstance(weighted_activities, dict):
            for activity_name, activity_value in weighted_activities.items():
                pairs.append((f"Weighted Activity Market Cap - {activity_name}", _numeric_text(activity_value)))

    out: List[tuple[str, str]] = []
    for label, value in pairs:
        if value == "N/A":
            continue
        out.append((label, value))
    return out


def _avg_numeric_dict_values(payload: Any) -> Optional[float]:
    if not isinstance(payload, dict):
        return None
    vals: List[float] = []
    for raw in payload.values():
        num = _first_float(raw)
        if num is not None:
            vals.append(float(num))
    if not vals:
        return None
    return float(sum(vals) / len(vals))


def _avg_numeric_values(values: Any) -> Optional[float]:
    if not isinstance(values, list):
        return None
    nums: List[float] = []
    for raw in values:
        num = _first_float(raw)
        if num is not None:
            nums.append(float(num))
    if not nums:
        return None
    return float(sum(nums) / len(nums))


def _std_numeric_values(values: Any) -> Optional[float]:
    if not isinstance(values, list):
        return None
    nums: List[float] = []
    for raw in values:
        num = _first_float(raw)
        if num is not None:
            nums.append(float(num))
    if not nums:
        return None
    avg = float(sum(nums) / len(nums))
    var = sum((v - avg) ** 2 for v in nums) / len(nums)
    return float(var ** 0.5)


def _collect_targets_from_methods(methods: Dict[str, Any]) -> List[float]:
    out: List[float] = []
    if not isinstance(methods, dict):
        return out
    for items in methods.values():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            val = _first_float(item.get("target_price"))
            if val is not None:
                out.append(float(val))
    return out


def _fmt_target_with_change(value: Any, current_price: Any) -> str:
    target = _first_float(value)
    if target is None:
        return "N/A"
    current = _first_float(current_price)
    if current is None or abs(float(current)) <= 1e-9:
        return _fmt_money(target)
    change_pct = ((float(target) - float(current)) / float(current)) * 100.0
    return f"{_fmt_money(target)} ({_fmt_signed_pct(change_pct)})"


def _build_valuation_summary_table(
    methods: Dict[str, Any],
    aggregate_targets: Dict[str, Any],
    aggregate_investments: Dict[str, Any],
    current_price: Any,
) -> str:
    if not isinstance(methods, dict):
        methods = {}
    if not isinstance(aggregate_targets, dict):
        aggregate_targets = {}
    if not isinstance(aggregate_investments, dict):
        aggregate_investments = {}

    rows: List[tuple[str, str, str]] = []
    method_names = list(methods.keys()) or sorted(
        set(aggregate_targets.keys()) | set(aggregate_investments.keys())
    )
    for method_name in method_names:
        rows.append(
            (
                str(method_name),
                _fmt_target_with_change(aggregate_targets.get(method_name), current_price),
                _fmt_money(aggregate_investments.get(method_name)),
            )
        )

    all_targets = _collect_targets_from_methods(methods)
    all_investments = _collect_investments_from_methods(methods)
    target_model_values = [
        float(v)
        for v in (_first_float(raw) for raw in aggregate_targets.values())
        if v is not None
    ]
    investment_model_values = [
        float(v)
        for v in (_first_float(raw) for raw in aggregate_investments.values())
        if v is not None
    ]

    mean_target_models = _avg_numeric_values(target_model_values)
    mean_target_all = _avg_numeric_values(all_targets)
    mean_investment_models = _avg_numeric_values(investment_model_values)
    mean_investment_all = _avg_numeric_values(all_investments)
    std_target_models = _std_numeric_values(target_model_values)
    std_target_all = _std_numeric_values(all_targets)
    std_investment_models = _std_numeric_values(investment_model_values)
    std_investment_all = _std_numeric_values(all_investments)

    rows.extend(
        [
            (
                "Mean",
                (
                    f"Across models: {_fmt_target_with_change(mean_target_models, current_price)}; "
                    f"Across all: {_fmt_target_with_change(mean_target_all, current_price)}"
                ),
                (
                    f"Across models: {_fmt_money(mean_investment_models)}; "
                    f"Across all: {_fmt_money(mean_investment_all)}"
                ),
            ),
            (
                "STD",
                (
                    f"Across models: {_fmt_money(std_target_models)}; "
                    f"Across all: {_fmt_money(std_target_all)}"
                ),
                (
                    f"Across models: {_fmt_money(std_investment_models)}; "
                    f"Across all: {_fmt_money(std_investment_all)}"
                ),
            ),
        ]
    )

    table_lines = [
        "## Valuation Summary",
        "",
        "| Model / Valuator | Price Target (Change From Current) | Investment Allocation |",
        "|---|---:|---:|",
    ]
    for name, target, allocation in rows:
        table_lines.append(f"| {name} | {target} | {allocation} |")
    return "\n".join(table_lines).strip()


def _build_assumptions_means_text(final_dict: Dict[str, Any], explain_payload: Optional[Dict[str, Any]] = None) -> str:
    lines: List[str] = []

    for label, key in [
        ("Representative Revenue", "Revenue"),
        ("Representative Earnings", "Net Income"),
        ("Representative P/E", "P/E"),
    ]:
        triplet = _extract_overall_triplet(final_dict, key)
        if not triplet:
            continue
        mean_v = triplet[0]
        lines.append(f"- {label} (Mean): {_fmt_number(mean_v)}")

    methods = explain_payload.get("methods", {}) if isinstance(explain_payload, dict) else {}
    scenario_dcf_items = methods.get("Scenario DCF", []) if isinstance(methods, dict) else []

    def _parse_raw(item: Dict[str, Any]) -> Dict[str, Any]:
        raw = item.get("raw_json", {})
        if isinstance(raw, dict) and raw:
            return raw
        txt = str(item.get("raw_json_text", "") or "").strip()
        if txt.startswith("{") and txt.endswith("}"):
            try:
                parsed = json.loads(txt)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return {}
        return {}

    dcf_vals: Dict[str, List[float]] = {
        "fcf": [],
        "g": [],
        "wacc": [],
        "terminal": [],
    }
    for item in scenario_dcf_items if isinstance(scenario_dcf_items, list) else []:
        if not isinstance(item, dict):
            continue
        raw = _parse_raw(item)
        if not raw:
            continue
        fcf_mid = _range_mid(raw.get("fcf_next_year"))
        g_mid = _range_mid(raw.get("g"))
        wacc_mid = _range_mid(raw.get("WACC"))
        terminal_mid = _range_mid(raw.get("TERMINAL"))
        if fcf_mid is not None:
            dcf_vals["fcf"].append(float(fcf_mid))
        if g_mid is not None:
            dcf_vals["g"].append(float(g_mid))
        if wacc_mid is not None:
            dcf_vals["wacc"].append(float(wacc_mid))
        if terminal_mid is not None:
            dcf_vals["terminal"].append(float(terminal_mid))

    def _avg(vals: List[float]) -> Optional[float]:
        if not vals:
            return None
        return float(sum(vals) / len(vals))

    bull = []
    base = []
    bear = []
    scenario_methods = [
        "Scenario DCF",
        "Target Scenario",
        "Earnings Scenario",
        "Revenue Scenario",
        "Composite Scenario",
        "SOTP Scenario",
    ]
    for method_name in scenario_methods:
        items = methods.get(method_name, []) if isinstance(methods, dict) else []
        if not isinstance(items, list):
            continue
        per_method: Dict[str, List[float]] = {"bull": [], "base": [], "bear": []}
        for item in items:
            if not isinstance(item, dict):
                continue
            raw = _parse_raw(item)
            if not raw:
                continue
            for key in ["bull", "base", "bear"]:
                entry = raw.get("scenarios", {}).get(key) if isinstance(raw.get("scenarios"), dict) else raw.get(key)
                p = None
                if isinstance(entry, (list, tuple)) and entry:
                    p = _first_float(entry[0])
                elif isinstance(entry, dict):
                    p = _first_float(entry.get("probability"))
                if p is None:
                    continue
                if p > 1.0 and p <= 100.0:
                    p = p / 100.0
                if 0.0 <= p <= 1.0:
                    per_method[key].append(float(p))
        for key, sink in [("bull", bull), ("base", base), ("bear", bear)]:
            p_mean = _avg(per_method[key])
            if p_mean is not None:
                sink.append(p_mean)

    if _avg(bull) is not None:
        lines.append(f"- Bull Probability (Blended Mean): {_fmt_pct(_avg(bull))}")
    if _avg(base) is not None:
        lines.append(f"- Base Probability (Blended Mean): {_fmt_pct(_avg(base))}")
    if _avg(bear) is not None:
        lines.append(f"- Bear Probability (Blended Mean): {_fmt_pct(_avg(bear))}")
    if _avg(dcf_vals["g"]) is not None:
        lines.append(f"- Growth Rate (G) [Scenario DCF Mean]: {_fmt_pct(_avg(dcf_vals['g']))}")
    if _avg(dcf_vals["fcf"]) is not None:
        lines.append(f"- Representative FCF [Scenario DCF Mean]: {_fmt_number(_avg(dcf_vals['fcf']))}")
    if _avg(dcf_vals["terminal"]) is not None:
        lines.append(f"- Terminal Value Growth [Scenario DCF Mean]: {_fmt_pct(_avg(dcf_vals['terminal']))}")
    if _avg(dcf_vals["wacc"]) is not None:
        lines.append(f"- WACC [Scenario DCF Mean]: {_fmt_pct(_avg(dcf_vals['wacc']))}")

    return "\n".join(lines).strip()


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


def _extract_reason_sections(value: Any, prefix: str = "") -> List[tuple[str, str]]:
    out: List[tuple[str, str]] = []
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


def _build_prices_explain_text(
    ticker: str,
    explain_payload: Dict[str, Any],
    final_dict: Optional[Dict[str, Any]] = None,
) -> str:
    methods = explain_payload.get("methods", {}) if isinstance(explain_payload, dict) else {}
    aggregate_targets = explain_payload.get("aggregate_targets", {}) if isinstance(explain_payload, dict) else {}
    aggregate_investments = explain_payload.get("aggregate_investments", {}) if isinstance(explain_payload, dict) else {}
    current_price = explain_payload.get("current_price") if isinstance(explain_payload, dict) else None

    lines: List[str] = [
        f"# {ticker} Prices Explain",
        "",
        "This report organizes each valuation method output from the valuation stage.",
        "Each output is split into key numeric values first, then full step-by-step/rationale text.",
        f"Current Price: {_fmt_money(current_price)}",
    ]

    summary_table = _build_valuation_summary_table(
        methods if isinstance(methods, dict) else {},
        aggregate_targets if isinstance(aggregate_targets, dict) else {},
        aggregate_investments if isinstance(aggregate_investments, dict) else {},
        current_price,
    )
    if summary_table:
        lines.extend(["", summary_table])

    assumptions_pack = _build_assumptions_pack_text(
        final_dict if isinstance(final_dict, dict) else {},
        explain_payload if isinstance(explain_payload, dict) else {},
    )
    if assumptions_pack:
        lines.extend(
            [
                "",
                "## Assumptions Pack",
                assumptions_pack,
            ]
        )

    if not isinstance(methods, dict) or not methods:
        lines.extend(["", "No valuation JSON outputs were collected."])
        return "\n".join(lines).strip() + "\n"

    for method_name, items in methods.items():
        lines.extend(["", "---", "", f"## {method_name}"])
        aggregate_target = aggregate_targets.get(method_name) if isinstance(aggregate_targets, dict) else None
        aggregate_investment = (
            aggregate_investments.get(method_name) if isinstance(aggregate_investments, dict) else None
        )
        lines.append(f"Method Target Price: {_fmt_money(aggregate_target)}")
        lines.append(f"Method Mean Investment: {_fmt_money(aggregate_investment)}")
        lines.append(f"Captured Outputs: {len(items) if isinstance(items, list) else 0}")

        if not isinstance(items, list) or not items:
            lines.append("No valid JSON output captured for this method.")
            continue

        for idx, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            persona = str(item.get("persona", "") or "").strip()
            run_header = f"### Output {idx}"
            if persona:
                run_header = f"{run_header} ({persona})"
            lines.extend(["", run_header])

            lines.append(f"- Output Target Price: {_fmt_money(item.get('target_price'))}")
            lines.append(f"- Output Investment Amount: {_fmt_money(item.get('investment_amount'))}")
            raw_json = _raw_json_dict_for_item(item)
            if not raw_json:
                lines.append("No JSON payload captured for this output.")
                continue

            numeric_pairs = _method_specific_numeric_pairs(str(method_name), raw_json)
            if not numeric_pairs:
                generic_pairs = _extract_numeric_pairs(raw_json)
                numeric_pairs = [( _humanize_numeric_key(k), v) for k, v in generic_pairs]
            lines.append("#### Key Numeric Values")
            if numeric_pairs:
                for key, value in numeric_pairs:
                    lines.append(f"- {key}: {value}")
            else:
                lines.append("No numeric fields were captured in this JSON output.")

            reason_sections = _extract_reason_sections(raw_json)
            if reason_sections:
                lines.append("")
                lines.append("#### Step-by-Step and Rationale (Full Text)")
                for key, txt in reason_sections:
                    label = key.replace("_", " ").strip()
                    lines.append("")
                    lines.append(f"##### {label}")
                    lines.append(txt)

    return "\n".join(lines).strip() + "\n"


def run_ticker_valuation(
    ticker: str,
    *,
    output_root: str = "outputs",
    save_pdf: bool = True,
    show_plots: bool = True,
    valuation_iterations: int = DEFAULT_VALUATION_ITERATIONS,
    analysis_workers: int = DEFAULT_ANALYSIS_WORKERS,
    llm_workers_each_block: int = DEFAULT_LLM_WORKERS,
    valuation_blocks_workers: int = DEFAULT_VALUATION_BLOCK_WORKERS,
    progress_file: Optional[str] = None,
    run_source: str = "site",
) -> Dict[str, object]:
    """Public entry - bookends the implementation with obs lifecycle."""
    from . import obs as _obs

    _obs.install()
    ticker_clean = ticker.upper().strip()
    obs_run_id = _obs.db.insert_run(ticker=ticker_clean, source=run_source)
    token = _obs.RUN_ID.set(obs_run_id) if obs_run_id else None
    obs_started = time.perf_counter()
    obs_status = "success"
    obs_error: Optional[str] = None
    try:
        return _run_ticker_valuation_impl(
            ticker,
            output_root=output_root,
            save_pdf=save_pdf,
            show_plots=show_plots,
            valuation_iterations=valuation_iterations,
            analysis_workers=analysis_workers,
            llm_workers_each_block=llm_workers_each_block,
            valuation_blocks_workers=valuation_blocks_workers,
            progress_file=progress_file,
            run_source=run_source,
        )
    except Exception as exc:
        obs_status = "error"
        obs_error = f"{type(exc).__name__}: {exc}"[:1000]
        raise
    finally:
        if token is not None:
            _obs.RUN_ID.reset(token)
        if obs_run_id:
            _obs.db.finalize_run_row(
                run_id=obs_run_id,
                status=obs_status,
                error_message=obs_error,
                duration_ms=int((time.perf_counter() - obs_started) * 1000),
            )


def _run_ticker_valuation_impl(
    ticker: str,
    *,
    output_root: str = "outputs",
    save_pdf: bool = True,
    show_plots: bool = True,
    valuation_iterations: int = DEFAULT_VALUATION_ITERATIONS,
    analysis_workers: int = DEFAULT_ANALYSIS_WORKERS,
    llm_workers_each_block: int = DEFAULT_LLM_WORKERS,
    valuation_blocks_workers: int = DEFAULT_VALUATION_BLOCK_WORKERS,
    progress_file: Optional[str] = None,
    run_source: str = "site",
) -> Dict[str, object]:
    """
    Runs the notebook-equivalent valuation flow for one ticker and saves artifacts.

    Core valuation idea/methods remain in `legacy_port.py`.
    This function only orchestrates IO and artifact paths.

    Note:
      `valuation_iterations` is retained for backward compatibility and is
      intentionally ignored. The valuation flow always runs with 1 combined pass.
    """
    _ = valuation_iterations
    _require_api_key()
    from . import legacy_port as legacy
    from . import obs as _obs

    ticker = ticker.upper().strip()
    out_dir = Path(output_root) / ticker
    out_dir.mkdir(parents=True, exist_ok=True)
    run_started = time.perf_counter()

    legacy.ticker = ticker
    try:
        from .competitor_market_review import SIDECAR_FILENAME as MARKET_REVIEW_SIDECAR

        Path(MARKET_REVIEW_SIDECAR).unlink(missing_ok=True)
    except Exception:
        pass

    with _obs.llm_context(stage="analyst"):
        info_dict, files_dict, financial_dict, variables_dict = legacy.make_analysis_file(
            ticker,
            parallel_workers=analysis_workers,
        )
    _append_progress(progress_file, "Finished analysis of Files and Financials")
    if not info_dict.get("short_name"):
        raise ValueError(f"Ticker '{ticker}' is invalid or unavailable")

    text = legacy.load_text_from_file("analysis.txt")
    regular_text = str(text or "").strip()
    notes: List[str] = []
    market_review_payload: Dict[str, Any] = {}
    market_review_json = ""
    try:
        from .competitor_market_review import SIDECAR_FILENAME as MARKET_REVIEW_SIDECAR

        market_review_sidecar = Path(MARKET_REVIEW_SIDECAR)
        if market_review_sidecar.exists():
            market_review_payload = json.loads(market_review_sidecar.read_text(encoding="utf-8"))
            if isinstance(market_review_payload, dict):
                market_review_target = out_dir / f"{ticker}_market_review.json"
                market_review_target.write_text(
                    json.dumps(market_review_payload, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                market_review_json = str(market_review_target.resolve())
            else:
                market_review_payload = {}
    except Exception as market_review_err:
        market_review_payload = {
            "status": "unavailable",
            "error": str(market_review_err),
        }
        notes.append(f"Competitor market review payload load failed: {market_review_err}")
    trading_agents_payload: Dict[str, Any] = {}
    trading_agents_context = ""
    trading_agents_json = ""
    trading_agents_txt = ""
    trading_agents_executor: Optional[ThreadPoolExecutor] = None
    trading_agents_future = None

    try:
        from .trading_agents_adapter import (
            run_trading_agents_lens,
        )

        trading_agents_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="trading-agents")

        def _run_trading_agents() -> Dict[str, Any]:
            with _obs.llm_context(stage="trading_agents"):
                return run_trading_agents_lens(
                    ticker=ticker,
                    output_dir=out_dir,
                    api_key=str(os.getenv("DEEPSEEK_API_KEY", "") or "").strip(),
                )

        trading_agents_future = _obs.obs_submit(trading_agents_executor, _run_trading_agents)
        _append_progress(progress_file, "Started TradingAgents Research Lens")
    except Exception as trading_agents_start_err:
        trading_agents_payload = {
            "status": "unavailable",
            "error": str(trading_agents_start_err),
        }
        notes.append(f"TradingAgents research lens failed to start: {trading_agents_start_err}")

    sec_qna_payload: Dict[str, Any] = {
        "status": "unavailable",
        "ticker": ticker,
        "text": "",
        "questions": [],
        "answers": [],
        "errors": [],
    }

    # SEC/MAYA pre-score Q&A: run only when filing text exists.
    if _has_filing_text(files_dict):
        try:
            from .service import build_sec_question_answer_text

            with _obs.llm_context(stage="sec.qa"):
                sec_qna_payload = build_sec_question_answer_text(
                    ticker=ticker,
                    analysis_text=regular_text,
                    files_dict=files_dict,
                    financial_dict=financial_dict,
                )
            sec_qna_errors = [str(e) for e in sec_qna_payload.get("errors", [])]
            sec_qna_text = str(sec_qna_payload.get("text", "") or "").strip()
            if sec_qna_payload.get("status") == "success" and sec_qna_text:
                legacy.append_text_to_file(
                    text=sec_qna_text,
                    header="SEC Pre-Score Questions & Answers",
                )
                print(f"SEC pre-score Q&A generated successfully for {ticker}")
            elif sec_qna_errors:
                notes.extend(sec_qna_errors[:3])
        except Exception as sec_qna_exc:
            notes.append(f"SEC pre-score Q&A generation failed: {sec_qna_exc}")

    sec_short_text = ""
    sec_fallback_used = False
    sec_fallback_message = ""
    if not _has_filing_text(files_dict):
        legacy.append_text_to_file(
            text="No filing text available in files_dict (SEC/MAYA). Continuing with regular analysis only.",
            header="SEC Summary (Warning)",
        )
        sec_fallback_used = True
        sec_fallback_message = "Filing download/parse failed or no filing text available; continuing without filing context."
        notes.append(
            "No filing text available. "
            "Valuation fallback applied: using regular analysis text for the combined pass."
        )
    else:
        try:
            from .service import build_sec_short_analysis_text

            with _obs.llm_context(stage="sec.short"):
                sec_out = build_sec_short_analysis_text(
                    ticker=ticker,
                    info_dict=info_dict,
                    files_dict=files_dict,
                    financial_dict=financial_dict,
                )

            sec_errors = [str(e) for e in sec_out.get("errors", [])]
            sec_candidate = str(sec_out.get("text", "")).strip()
            if sec_out.get("status") == "success" and sec_candidate:
                currency_clarification = _build_sec_currency_clarification(info_dict)
                sec_short_text = (
                    f"{sec_candidate}\n\n{currency_clarification}"
                    if currency_clarification
                    else sec_candidate
                )
                legacy.append_text_to_file(
                    text=sec_short_text,
                    header="SEC Summary",
                )
                print(f"SEC summary generated successfully for {ticker}")

                if sec_errors:
                    legacy.append_text_to_file(
                        text="\n".join(sec_errors[:3]),
                        header="SEC Summary Notes",
                    )
                    notes.extend(sec_errors[:3])
            else:
                warn = "\n".join(sec_errors[:3]) if sec_errors else "SEC summary generation failed."
                legacy.append_text_to_file(
                    text=warn,
                    header="SEC Summary (Warning)",
                )
                sec_fallback_used = True
                sec_fallback_message = "Filing download/parse failed or no filing text available; continuing without filing context."
                notes.append(
                    "SEC summary failed or was empty. "
                    "Valuation fallback applied: using regular analysis text for the combined pass."
                )
                if sec_errors:
                    notes.extend(sec_errors[:3])
        except Exception as sec_exc:
            warn_text = f"SEC summary generation failed: {sec_exc}"
            legacy.append_text_to_file(
                text=warn_text,
                header="SEC Summary (Warning)",
            )
            print(f"Warning: SEC summary generation failed for {ticker}.")
            sec_fallback_used = True
            sec_fallback_message = "Filing download/parse failed or no filing text available; continuing without filing context."
            notes.append(
                "SEC summary generation raised an exception. "
                "Valuation fallback applied: using regular analysis text for the combined pass."
            )
            notes.append(warn_text)
    sec_sources = _format_sec_sources(files_dict)
    _append_progress(
        progress_file,
        f"Finished analysis from SEC Filings. Sources used: {sec_sources}",
    )

    if not regular_text:
        regular_text = str(text or "")
    try:
        latest_text = legacy.load_text_from_file("analysis.txt")
        if str(latest_text or "").strip():
            regular_text = str(latest_text or "").strip()
    except Exception:
        pass

    try:
        from .trading_agents_adapter import (
            CONTEXT_HEADER as TRADING_AGENTS_CONTEXT_HEADER,
            build_trading_agents_context,
        )

        if trading_agents_future is not None:
            trading_agents_payload = trading_agents_future.result()
        trading_agents_json = str(trading_agents_payload.get("artifact_json") or "")
        trading_agents_txt = str(trading_agents_payload.get("artifact_txt") or "")
        trading_agents_context = build_trading_agents_context(trading_agents_payload)
        if trading_agents_context:
            legacy.append_text_to_file(
                text=trading_agents_context,
                header=TRADING_AGENTS_CONTEXT_HEADER,
            )
            latest_text = legacy.load_text_from_file("analysis.txt")
            if str(latest_text or "").strip():
                regular_text = str(latest_text or "").strip()
        elif trading_agents_payload.get("status") not in {"", None, "success"}:
            notes.append(
                "TradingAgents research lens unavailable: "
                f"{trading_agents_payload.get('error') or trading_agents_payload.get('status')}"
            )
    except Exception as trading_agents_err:
        trading_agents_payload = {
            "status": "unavailable",
            "error": str(trading_agents_err),
        }
        notes.append(f"TradingAgents research lens failed: {trading_agents_err}")
    finally:
        if trading_agents_executor is not None:
            trading_agents_executor.shutdown(wait=False)
    _append_progress(progress_file, "Finished TradingAgents Research Lens")

    pre_dashboard_red_flags = deterministic_red_flags(
        price_cv=None,
        lmil=None,
    )
    with _obs.llm_context(stage="dashboard.extract"):
        qualitative_sections = generate_dashboard_sections(
            ticker=ticker,
            analysis_text=regular_text,
            sec_short_text=sec_short_text,
            financial_dict=financial_dict,
            deterministic_red_flags=pre_dashboard_red_flags,
            enable_llm_extractions=True,
        )
    _append_progress(progress_file, "Finished Dashboard Extraction (Pre-Valuation)")

    try:
        appendix_text = build_dashboard_appendix_text(ticker, qualitative_sections)
        legacy.append_text_to_file(
            text=appendix_text,
            header="Dashboard Extraction Pack",
        )
        latest_text = legacy.load_text_from_file("analysis.txt")
        if str(latest_text or "").strip():
            regular_text = str(latest_text or "").strip()
    except Exception as extraction_err:
        notes.append(f"Dashboard extraction append failed: {extraction_err}")

    valuation_contexts = [regular_text]

    explain_payload: Dict[str, Any] = {}
    with _obs.llm_context(stage="valuations"):
        final_dict = legacy.run_valuations(
            ticker,
            info_dict,
            financial_dict,
            variables_dict,
            regular_text,
            n=1,
            llm_workers_each_block=llm_workers_each_block,
            blocks_workers=valuation_blocks_workers,
            add_text=False,
            valuation_contexts=valuation_contexts,
            explain_collector=explain_payload,
        )
    _append_progress(progress_file, "Finished Valuations")

    wall_st_payload: Dict[str, Any] = {}
    try:
        wall_st_payload = build_wall_st_payload(ticker=ticker, info_dict=info_dict)
        with _obs.llm_context(stage="wall_st"):
            wall_st_synthesis = generate_wall_st_synthesis(ticker=ticker, wall_st_payload=wall_st_payload)
        wall_st_payload = build_wall_st_payload(
            ticker=ticker,
            info_dict=info_dict,
            synthesis=wall_st_synthesis,
        )
    except Exception as wall_st_err:
        wall_st_payload = build_wall_st_payload(
            ticker=ticker,
            info_dict=info_dict,
            errors=[str(wall_st_err)],
        )
        notes.append(f"Wall ST dashboard payload failed: {wall_st_err}")

    revenue_dict = final_dict.get("Revenue", {}) if isinstance(final_dict, dict) else {}
    earnings_dict = final_dict.get("Net Income", {}) if isinstance(final_dict, dict) else {}
    revenue_overall = revenue_dict.get("Overall", []) if isinstance(revenue_dict, dict) else []
    earnings_overall = earnings_dict.get("Overall", []) if isinstance(earnings_dict, dict) else []
    current_revenue = _first_float(revenue_dict.get("Current")) if isinstance(revenue_dict, dict) else None
    target_revenue = _first_float(revenue_overall[0] if isinstance(revenue_overall, list) and revenue_overall else None)
    current_earnings = _first_float(earnings_dict.get("Current")) if isinstance(earnings_dict, dict) else None
    target_earnings = _first_float(earnings_overall[0] if isinstance(earnings_overall, list) and earnings_overall else None)
    legacy.plot_all_three(
        final_dict,
        ticker,
        output_dir=str(out_dir),
        show_plot=show_plots,
        include_pe=False,
    )

    legacy.print_overall_valuations(ticker, final_dict, variables_dict)

    analysis_src = Path("analysis.txt")
    analysis_dst = out_dir / f"{ticker}_analysis.txt"
    if analysis_src.exists():
        shutil.copy(analysis_src, analysis_dst)

    prices_explain_txt = out_dir / f"{ticker}_prices_explain.txt"
    prices_explain_pdf = ""
    prices_explain_html = out_dir / f"{ticker}_prices_explain.html"
    dashboard_json = ""
    dashboard_signal_snapshot_text = ""
    explain_text = ""
    try:
        explain_text = _build_prices_explain_text(
            ticker,
            explain_payload,
            final_dict if isinstance(final_dict, dict) else {},
        )
        prices_explain_txt.write_text(explain_text, encoding="utf-8")
    except Exception as explain_err:
        notes.append(f"Prices explain TXT generation failed: {explain_err}")

    technical_analysis_payload: Dict[str, Any] = {}
    technical_analysis_markdown = ""
    technical_analysis_json = ""
    try:
        from .technical_analysis import (
            run_full_analysis as run_technical_analysis,
            technical_analysis_to_markdown,
        )

        technical_model = str(os.getenv("TECHNICAL_ANALYSIS_MODEL", "deepseek-chat") or "deepseek-chat").strip() or "deepseek-chat"
        with _obs.llm_context(stage="technical"):
            technical_run = run_technical_analysis(
                ticker=ticker,
                api_key=str(os.getenv("DEEPSEEK_API_KEY", "") or "").strip(),
                model=technical_model,
                temperature=0.1,
            )
        technical_analysis_payload = {
            "status": "success",
            "generated_at": technical_run.get("created_at"),
            "model": technical_run.get("model", technical_model),
            "analysis": technical_run.get("analysis", {}),
        }
        technical_analysis_markdown = technical_analysis_to_markdown(
            technical_analysis_payload.get("analysis", {})
        )
        technical_analysis_json_path = out_dir / f"{ticker}_technical_analysis.json"
        technical_analysis_json_path.write_text(
            json.dumps(technical_analysis_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        technical_analysis_json = str(technical_analysis_json_path.resolve())
    except Exception as technical_err:
        technical_analysis_payload = {
            "status": "error",
            "error": str(technical_err),
        }
        notes.append(f"Technical analysis generation failed: {technical_err}")
    _append_progress(progress_file, "Finished Technical Analysis")

    financials_payload: Dict[str, Any] = {}
    financials_markdown = ""
    financials_json = ""
    try:
        from .financials_agent import (
            financials_analysis_to_markdown,
            run_full_analysis as run_financials_analysis,
        )

        financials_model = str(os.getenv("FINANCIALS_AGENT_MODEL", "deepseek-reasoner") or "deepseek-reasoner").strip() or "deepseek-reasoner"
        with _obs.llm_context(stage="financials"):
            financials_run = run_financials_analysis(
                ticker=ticker,
                info_dict=info_dict,
                api_key=str(os.getenv("DEEPSEEK_API_KEY", "") or "").strip(),
                model=financials_model,
                temperature=0.1,
            )
        financials_payload = {
            "status": "success",
            "generated_at": financials_run.get("created_at"),
            "model": financials_run.get("model", financials_model),
            "analysis": financials_run.get("analysis", {}),
        }
        financials_markdown = financials_analysis_to_markdown(
            financials_payload.get("analysis", {})
        )
        financials_json_path = out_dir / f"{ticker}_financials.json"
        financials_json_path.write_text(
            json.dumps(financials_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        financials_json = str(financials_json_path.resolve())
    except Exception as financials_err:
        financials_payload = {
            "status": "error",
            "error": str(financials_err),
        }
        notes.append(f"Financials agent generation failed: {financials_err}")
    _append_progress(progress_file, "Finished Financials Agent")

    try:
        if analysis_src.exists():
            base_analysis_text = analysis_src.read_text(encoding="utf-8")
        elif analysis_dst.exists():
            base_analysis_text = analysis_dst.read_text(encoding="utf-8")
        else:
            base_analysis_text = regular_text

        merged_analysis_text = str(base_analysis_text or "").strip()
        wall_st_markdown = _wall_st_synthesis_to_markdown(wall_st_payload)
        if str(wall_st_markdown or "").strip():
            merged_analysis_text = _upsert_markdown_block(
                merged_analysis_text,
                "## Wall ST Analyst Read",
                wall_st_markdown,
            )
        if str(technical_analysis_markdown or "").strip():
            merged_analysis_text = _upsert_markdown_block(
                merged_analysis_text,
                "## Technical Analysis",
                technical_analysis_markdown,
            )
        if str(financials_markdown or "").strip():
            merged_analysis_text = _upsert_markdown_block(
                merged_analysis_text,
                "## Financials",
                financials_markdown,
            )
        if merged_analysis_text.strip():
            analysis_src.write_text(merged_analysis_text + "\n", encoding="utf-8")
            analysis_dst.write_text(merged_analysis_text + "\n", encoding="utf-8")
            regular_text = merged_analysis_text.strip()
    except Exception as analysis_merge_err:
        notes.append(f"Full analysis text merge failed: {analysis_merge_err}")

    market_review_payload, market_review_json = _attach_market_agent_markdown(
        payload=market_review_payload,
        analysis_text=regular_text,
        out_dir=out_dir,
        ticker=ticker,
        market_review_json=market_review_json,
    )

    try:
        analysis_duration_minutes = round((time.perf_counter() - run_started) / 60.0, 2)
        filing_sources = _extract_latest_filing_sources(files_dict)
        dashboard_payload = build_dashboard_payload(
            ticker=ticker,
            info_dict=info_dict,
            financial_dict=financial_dict,
            variables_dict=variables_dict,
            final_dict=final_dict if isinstance(final_dict, dict) else {},
            explain_payload=explain_payload,
            analysis_text=regular_text,
            sec_short_text=sec_short_text,
            sec_qna=sec_qna_payload,
            qualitative_sections=qualitative_sections,
            technical_analysis=technical_analysis_payload,
            trading_agents=trading_agents_payload,
            market_review=market_review_payload,
            wall_st=wall_st_payload,
            financials=financials_payload,
            filings=filing_sources,
            enable_llm_extractions=True,
            analysis_duration_minutes=analysis_duration_minutes,
            artifacts={
                "analysis_txt": str(analysis_dst.resolve()) if analysis_dst.exists() else "",
                "prices_plot": str((out_dir / f"{ticker}_prices_valuation.png").resolve()),
                "revenue_plot": str((out_dir / f"{ticker}_revenue_valuation.png").resolve()),
                "net_income_plot": str((out_dir / f"{ticker}_net_income_valuation.png").resolve()),
                "prices_explain_txt": str(prices_explain_txt.resolve()) if prices_explain_txt.exists() else "",
                "technical_analysis_json": technical_analysis_json,
                "trading_agents_json": trading_agents_json,
                "trading_agents_txt": trading_agents_txt,
                "market_review_json": market_review_json,
                "financials_json": financials_json,
            },
        )
        dashboard_json = write_dashboard_payload(out_dir / f"{ticker}_dashboard.json", dashboard_payload)
        try:
            dashboard_signal_snapshot_text = _build_dashboard_signal_snapshot_text(dashboard_payload)
        except Exception as signal_snapshot_err:
            notes.append(f"Dashboard signal snapshot generation failed: {signal_snapshot_err}")
    except Exception as dashboard_err:
        notes.append(f"Dashboard JSON generation failed: {dashboard_err}")

    if prices_explain_txt.exists():
        try:
            if dashboard_signal_snapshot_text:
                base_explain_text = prices_explain_txt.read_text(encoding="utf-8")
                enriched_explain_text = _upsert_markdown_block(
                    base_explain_text,
                    "## Dashboard Signal Snapshot",
                    dashboard_signal_snapshot_text,
                )
                if enriched_explain_text.strip():
                    prices_explain_txt.write_text(enriched_explain_text + "\n", encoding="utf-8")

            from .text_to_pdf_check import convert_text_to_pdf

            convert_text_to_pdf(
                prices_explain_txt,
                out_dir / f"{ticker}_prices_explain.pdf",
                prices_explain_html,
            )
            pdf_candidate = out_dir / f"{ticker}_prices_explain.pdf"
            if pdf_candidate.exists():
                prices_explain_pdf = str(pdf_candidate.resolve())
        except Exception as explain_pdf_err:
            notes.append(f"Prices explain PDF generation failed: {explain_pdf_err}")

    pdf_dst = ""
    if save_pdf:
        target_pdf = out_dir / f"{ticker}_analysis.pdf"
        target_html = out_dir / f"{ticker}_analysis.html"
        try:
            from .text_to_pdf_check import convert_text_to_pdf

            merged_pdf_source = out_dir / f"{ticker}_analysis_pdf_source.txt"
            merged_parts: List[str] = []
            analysis_text_for_pdf = ""
            if analysis_src.exists():
                analysis_text_for_pdf = analysis_src.read_text(encoding="utf-8")
                merged_parts.append(analysis_text_for_pdf)
            elif analysis_dst.exists():
                analysis_text_for_pdf = analysis_dst.read_text(encoding="utf-8")
                merged_parts.append(analysis_text_for_pdf)

            merged_text = "\n\n---\n\n".join(part.strip() for part in merged_parts if str(part).strip()).strip()
            sources_footer = _build_sec_sources_footer(files_dict)
            if sources_footer:
                merged_text = f"{merged_text}\n\n---\n\n{sources_footer}".strip()
            if merged_text:
                merged_pdf_source.write_text(merged_text + "\n", encoding="utf-8")
                convert_text_to_pdf(merged_pdf_source, target_pdf, target_html)
                if target_pdf.exists():
                    pdf_dst = str(target_pdf.resolve())
        except Exception as merged_pdf_err:
            notes.append(f"Merged analysis PDF generation failed: {merged_pdf_err}")

        if not pdf_dst:
            try:
                legacy.pdf_downloader(ticker)
            except Exception as pdf_err:
                print(f"Warning: PDF generation failed, continuing without PDF. Error: {pdf_err}")
            pdf_src = Path(f"{ticker}_analysis.pdf")
            html_src = Path(f"{ticker}_analysis.html")
            if pdf_src.exists():
                shutil.move(str(pdf_src), target_pdf)
                pdf_dst = str(target_pdf.resolve())
            if html_src.exists():
                shutil.move(str(html_src), target_html)

    combined_pdf = ""
    if pdf_dst or prices_explain_pdf:
        try:
            combined_pdf = _combine_pdf_artifacts(
                [
                    Path(pdf_dst) if pdf_dst else None,
                    Path(prices_explain_pdf) if prices_explain_pdf else None,
                ],
                out_dir / f"{ticker}_combined.pdf",
            )
        except Exception as combined_pdf_err:
            notes.append(f"Combined PDF generation failed: {combined_pdf_err}")

    store = get_artifact_store()
    artifact_local_paths: Dict[str, Path] = {
        "analysis-txt": analysis_dst,
        "analysis-pdf": Path(pdf_dst) if pdf_dst else None,
        "prices-explain-txt": prices_explain_txt,
        "prices-explain-pdf": Path(prices_explain_pdf) if prices_explain_pdf else None,
        "combined-pdf": Path(combined_pdf) if combined_pdf else None,
        "dashboard-json": Path(dashboard_json) if dashboard_json else None,
        "prices-chart": out_dir / f"{ticker}_prices_valuation.png",
        "revenue-chart": out_dir / f"{ticker}_revenue_valuation.png",
        "net-income-chart": out_dir / f"{ticker}_net_income_valuation.png",
        "trading-agents-json": Path(trading_agents_json) if trading_agents_json else None,
        "trading-agents-txt": Path(trading_agents_txt) if trading_agents_txt else None,
        "market-review-json": Path(market_review_json) if market_review_json else None,
        "financials-json": Path(financials_json) if financials_json else None,
    }
    generated_at_iso = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    collected_keys: Dict[str, str] = {}
    for kind, local_path in artifact_local_paths.items():
        if local_path is None or not local_path.exists():
            continue
        r2_key = f"reports/{ticker}/{generated_at_iso}/{local_path.name}"
        collected_keys[kind] = store.put(local_path, key=r2_key)
    r2_keys: Optional[Dict[str, str]] = collected_keys if store.is_remote else None

    try:
        from ai_hedge.db.writer import write_run_to_db
        _rid, _db_err = write_run_to_db(
            out_dir.resolve(),
            source=run_source,
            max_attempts=3,
            retry_backoff_seconds=1.5,
            r2_keys=r2_keys,
        )
        if _db_err:
            print(f"[runner] DB write failed: {_db_err}", file=sys.stderr)
    except Exception as _db_exc:  # noqa: BLE001
        print(f"[runner] DB write skipped: {_db_exc}", file=sys.stderr)

    artifacts = RunArtifacts(
        ticker=ticker,
        output_dir=str(out_dir.resolve()),
        analysis_txt=str(analysis_dst.resolve()),
        prices_plot=str((out_dir / f"{ticker}_prices_valuation.png").resolve()),
        revenue_plot=str((out_dir / f"{ticker}_revenue_valuation.png").resolve()),
        net_income_plot=str((out_dir / f"{ticker}_net_income_valuation.png").resolve()),
        analysis_pdf=pdf_dst,
        prices_explain_txt=str(prices_explain_txt.resolve()) if prices_explain_txt.exists() else "",
        prices_explain_pdf=prices_explain_pdf,
        combined_pdf=combined_pdf,
        dashboard_json=dashboard_json,
        trading_agents_json=trading_agents_json,
        trading_agents_txt=trading_agents_txt,
        market_review_json=market_review_json,
        financials_json=financials_json,
        notes=notes,
        current_revenue=current_revenue,
        target_revenue=target_revenue,
        current_earnings=current_earnings,
        target_earnings=target_earnings,
        sec_fallback_used=sec_fallback_used,
        sec_fallback_message=sec_fallback_message,
        r2_keys=r2_keys,
    )

    return {
        "ticker": artifacts.ticker,
        "output_dir": artifacts.output_dir,
        "analysis_txt": artifacts.analysis_txt,
        "prices_plot": artifacts.prices_plot,
        "revenue_plot": artifacts.revenue_plot,
        "net_income_plot": artifacts.net_income_plot,
        "analysis_pdf": artifacts.analysis_pdf,
        "prices_explain_txt": artifacts.prices_explain_txt,
        "prices_explain_pdf": artifacts.prices_explain_pdf,
        "combined_pdf": artifacts.combined_pdf,
        "dashboard_json": artifacts.dashboard_json,
        "trading_agents_json": artifacts.trading_agents_json,
        "trading_agents_txt": artifacts.trading_agents_txt,
        "market_review_json": artifacts.market_review_json,
        "financials_json": artifacts.financials_json,
        "notes": artifacts.notes,
        "current_revenue": artifacts.current_revenue,
        "target_revenue": artifacts.target_revenue,
        "current_earnings": artifacts.current_earnings,
        "target_earnings": artifacts.target_earnings,
        "analysis_duration_minutes": round((time.perf_counter() - run_started) / 60.0, 2),
        "sec_fallback_used": artifacts.sec_fallback_used,
        "sec_fallback_message": artifacts.sec_fallback_message,
        "r2_keys": artifacts.r2_keys,
    }
