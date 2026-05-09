from __future__ import annotations

import os
import shutil
import sys
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .dashboard import (
    build_dashboard_appendix_text,
    build_dashboard_payload,
    deterministic_red_flags,
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
    dashboard_json: str
    notes: List[str]
    current_revenue: Optional[float]
    target_revenue: Optional[float]
    current_earnings: Optional[float]
    target_earnings: Optional[float]
    f_score_text: str
    sec_fallback_used: bool
    sec_fallback_message: str
    r2_keys: Optional[Dict[str, str]] = None



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


def _filing_source_label(form_type: str, raw: Dict[str, Any]) -> str:
    explicit = str(raw.get("source", "") or "").strip().upper()
    if explicit in {"SEC", "MAYA"}:
        return explicit
    if str(form_type or "").strip().upper().startswith("MAYA"):
        return "MAYA"
    return "SEC"


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
    decision_card = dashboard_payload.get("decision_card") or {}
    currency_code = header.get("display_currency") or header.get("currency") or "USD"

    current_price = _first_float(consensus.get("current_price"))
    mean_target_price = _first_float(consensus.get("mean_target_price"))

    target_change_pct = _first_float(decision_card.get("target_return_pct"))
    if (
        target_change_pct is None
        and current_price is not None
        and mean_target_price is not None
        and abs(current_price) > 1e-9
    ):
        target_change_pct = ((mean_target_price - current_price) / current_price) * 100.0

    investment_pct = _first_float(decision_card.get("position_size_pct_of_notional"))

    disagreement_score = _first_float(decision_card.get("overall_cv"))
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
    scenario_items = methods.get("Scenario DCF", []) if isinstance(methods, dict) else []
    dcf_items = methods.get("DCF", []) if isinstance(methods, dict) else []
    dcf_assumption_items: List[Dict[str, Any]] = []
    if isinstance(scenario_items, list):
        dcf_assumption_items.extend(item for item in scenario_items if isinstance(item, dict))
    if isinstance(dcf_items, list):
        dcf_assumption_items.extend(item for item in dcf_items if isinstance(item, dict))

    if dcf_assumption_items:
        weighted_fcf_vals: List[float] = []
        weighted_g_vals: List[float] = []
        weighted_wacc_vals: List[float] = []
        weighted_terminal_vals: List[float] = []
        bull_prob_vals: List[float] = []
        base_prob_vals: List[float] = []
        bear_prob_vals: List[float] = []

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

            # Scenario DCF contributes probability fields; intrinsic DCF does not.
            for label, bucket in [("bull", bull_prob_vals), ("base", base_prob_vals), ("bear", bear_prob_vals)]:
                arr = raw.get(label)
                if isinstance(arr, (list, tuple)) and len(arr) >= 1:
                    p = _first_float(arr[0])
                    if p is not None:
                        bucket.append(float(p))

        def _avg(vals: List[float]) -> Optional[float]:
            if not vals:
                return None
            return float(sum(vals) / len(vals))

        scenario_lines = [
            ("Bull Probability", _avg(bull_prob_vals), "pct"),
            ("Base Probability", _avg(base_prob_vals), "pct"),
            ("Bear Probability", _avg(bear_prob_vals), "pct"),
            ("Growth Rate (G) [DCF + Scenario DCF]", _avg(weighted_g_vals), "pct"),
            ("Representative FCF [DCF + Scenario DCF]", _avg(weighted_fcf_vals), "num"),
            ("Terminal Value Growth [DCF + Scenario DCF]", _avg(weighted_terminal_vals), "pct"),
            ("WACC [DCF + Scenario DCF]", _avg(weighted_wacc_vals), "pct"),
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

    all_investments = explain_payload.get("all_investments", []) if isinstance(explain_payload, dict) else []
    if not isinstance(all_investments, list) or not all_investments:
        all_investments = _collect_investments_from_methods(methods)
    all_investments = [float(v) for v in all_investments if isinstance(v, (int, float))]

    mean_investment = explain_payload.get("mean_investment") if isinstance(explain_payload, dict) else None
    std_investment = explain_payload.get("investment_std") if isinstance(explain_payload, dict) else None
    lmil = explain_payload.get("lmil") if isinstance(explain_payload, dict) else None
    if not isinstance(mean_investment, (int, float)):
        mean_investment = (sum(all_investments) / len(all_investments)) if all_investments else 0.0
    if not isinstance(std_investment, (int, float)):
        if all_investments:
            avg = float(mean_investment)
            var = sum((float(v) - avg) ** 2 for v in all_investments) / len(all_investments)
            std_investment = var ** 0.5
        else:
            std_investment = 0.0
    if not (isinstance(lmil, (list, tuple)) and len(lmil) >= 2):
        mean_pct = (float(mean_investment) / 100000.0) * 100.0
        lmil_cv = (float(std_investment) / float(mean_investment)) if abs(float(mean_investment)) > 1e-9 else 0.0
        lmil = [mean_pct, lmil_cv]

    lines.extend(
        [
            "",
            "## Investment Signal",
            f"Total Investment Votes: {len(all_investments)}",
            (
                "Investment Votes (USD): "
                + ", ".join(_fmt_money(v) for v in all_investments)
                if all_investments
                else "Investment Votes (USD): None"
            ),
            f"Mean Investment Amount: {_fmt_money(mean_investment)}",
            f"Investment STD: {_fmt_money(std_investment)}",
            f"LMIL: [{float(lmil[0]):.2f}%, {float(lmil[1]):.2f}]",
        ]
    )

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

            lines.append(f"Output Target Price: {_fmt_money(item.get('target_price'))}")
            lines.append(f"Output Investment Amount: {_fmt_money(item.get('investment_amount'))}")
            raw_json = _raw_json_dict_for_item(item)
            if not raw_json:
                lines.append("No JSON payload captured for this output.")
                continue

            numeric_pairs = _extract_numeric_pairs(raw_json)
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

    # SEC/MAYA pre-decision Q&A: run only when filing text exists.
    if _has_filing_text(files_dict):
        try:
            from .service import build_sec_question_answer_text

            with _obs.llm_context(stage="sec.qa"):
                sec_qna_out = build_sec_question_answer_text(
                    ticker=ticker,
                    analysis_text=regular_text,
                    files_dict=files_dict,
                    financial_dict=financial_dict,
                )
            sec_qna_errors = [str(e) for e in sec_qna_out.get("errors", [])]
            sec_qna_text = str(sec_qna_out.get("text", "") or "").strip()
            if sec_qna_out.get("status") == "success" and sec_qna_text:
                legacy.append_text_to_file(
                    text=sec_qna_text,
                    header="SEC Pre-Decision Questions & Answers",
                )
                print(f"SEC pre-decision Q&A generated successfully for {ticker}")
            elif sec_qna_errors:
                notes.extend(sec_qna_errors[:3])
        except Exception as sec_qna_exc:
            notes.append(f"SEC pre-decision Q&A generation failed: {sec_qna_exc}")

    sec_short_text = ""
    sec_fallback_used = False
    sec_fallback_message = ""
    if not _has_filing_text(files_dict):
        legacy.append_text_to_file(
            text="No filing text available in files_dict (SEC/MAYA). Continuing with regular analysis only.",
            header="SEC Short Analysis Context (Warning)",
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
                sec_short_text = sec_candidate
                legacy.append_text_to_file(
                    text=sec_short_text,
                    header="SEC Short Analysis Context",
                )
                print(f"SEC short analysis generated successfully for {ticker}")

                if sec_errors:
                    legacy.append_text_to_file(
                        text="\n".join(sec_errors[:3]),
                        header="SEC Short Analysis Notes",
                    )
                    notes.extend(sec_errors[:3])
            else:
                warn = "\n".join(sec_errors[:3]) if sec_errors else "SEC short analysis generation failed."
                legacy.append_text_to_file(
                    text=warn,
                    header="SEC Short Analysis Context (Warning)",
                )
                sec_fallback_used = True
                sec_fallback_message = "Filing download/parse failed or no filing text available; continuing without filing context."
                notes.append(
                    "SEC short analysis failed or was empty. "
                    "Valuation fallback applied: using regular analysis text for the combined pass."
                )
                if sec_errors:
                    notes.extend(sec_errors[:3])
        except Exception as sec_exc:
            warn_text = f"SEC short analysis generation failed: {sec_exc}"
            legacy.append_text_to_file(
                text=warn_text,
                header="SEC Short Analysis Context (Warning)",
            )
            print(f"Warning: SEC short analysis generation failed for {ticker}.")
            sec_fallback_used = True
            sec_fallback_message = "Filing download/parse failed or no filing text available; continuing without filing context."
            notes.append(
                "SEC short analysis generation raised an exception. "
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

    pre_dashboard_red_flags = deterministic_red_flags(
        f_score_text=str(variables_dict.get("f_score", "") or ""),
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

    revenue_dict = final_dict.get("Revenue", {}) if isinstance(final_dict, dict) else {}
    earnings_dict = final_dict.get("Net Income", {}) if isinstance(final_dict, dict) else {}
    revenue_overall = revenue_dict.get("Overall", []) if isinstance(revenue_dict, dict) else []
    earnings_overall = earnings_dict.get("Overall", []) if isinstance(earnings_dict, dict) else []
    current_revenue = _first_float(revenue_dict.get("Current")) if isinstance(revenue_dict, dict) else None
    target_revenue = _first_float(revenue_overall[0] if isinstance(revenue_overall, list) and revenue_overall else None)
    current_earnings = _first_float(earnings_dict.get("Current")) if isinstance(earnings_dict, dict) else None
    target_earnings = _first_float(earnings_overall[0] if isinstance(earnings_overall, list) and earnings_overall else None)
    f_score_text = str(variables_dict.get("f_score", "") or "").strip()

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

    if prices_explain_txt.exists():
        try:
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

    try:
        if analysis_src.exists():
            base_analysis_text = analysis_src.read_text(encoding="utf-8")
        elif analysis_dst.exists():
            base_analysis_text = analysis_dst.read_text(encoding="utf-8")
        else:
            base_analysis_text = regular_text

        merged_analysis_text = str(base_analysis_text or "").strip()
        if prices_explain_txt.exists():
            prices_section_text = prices_explain_txt.read_text(encoding="utf-8")
            if str(prices_section_text or "").strip():
                merged_analysis_text = _upsert_markdown_block(
                    merged_analysis_text,
                    f"# {ticker} Prices Explain",
                    prices_section_text,
                )
        if str(technical_analysis_markdown or "").strip():
            merged_analysis_text = _upsert_markdown_block(
                merged_analysis_text,
                "## Technical Analysis",
                technical_analysis_markdown,
            )
        if merged_analysis_text.strip():
            analysis_src.write_text(merged_analysis_text + "\n", encoding="utf-8")
            analysis_dst.write_text(merged_analysis_text + "\n", encoding="utf-8")
            regular_text = merged_analysis_text.strip()
    except Exception as analysis_merge_err:
        notes.append(f"Full analysis text merge failed: {analysis_merge_err}")

    try:
        analysis_duration_minutes = round((time.perf_counter() - run_started) / 60.0, 2)
        dashboard_payload = build_dashboard_payload(
            ticker=ticker,
            info_dict=info_dict,
            financial_dict=financial_dict,
            variables_dict=variables_dict,
            final_dict=final_dict if isinstance(final_dict, dict) else {},
            explain_payload=explain_payload,
            analysis_text=regular_text,
            sec_short_text=sec_short_text,
            qualitative_sections=qualitative_sections,
            technical_analysis=technical_analysis_payload,
            enable_llm_extractions=True,
            analysis_duration_minutes=analysis_duration_minutes,
            artifacts={
                "analysis_txt": str(analysis_dst.resolve()) if analysis_dst.exists() else "",
                "prices_plot": str((out_dir / f"{ticker}_prices_valuation.png").resolve()),
                "revenue_plot": str((out_dir / f"{ticker}_revenue_valuation.png").resolve()),
                "net_income_plot": str((out_dir / f"{ticker}_net_income_valuation.png").resolve()),
                "prices_explain_txt": str(prices_explain_txt.resolve()) if prices_explain_txt.exists() else "",
                "technical_analysis_json": technical_analysis_json,
            },
        )
        dashboard_json = write_dashboard_payload(out_dir / f"{ticker}_dashboard.json", dashboard_payload)
        try:
            snapshot_text = _build_dashboard_signal_snapshot_text(dashboard_payload)
            if snapshot_text:
                if analysis_src.exists():
                    base_analysis_text = analysis_src.read_text(encoding="utf-8")
                elif analysis_dst.exists():
                    base_analysis_text = analysis_dst.read_text(encoding="utf-8")
                else:
                    base_analysis_text = regular_text

                enriched_text = _upsert_dashboard_signal_snapshot_section(base_analysis_text, snapshot_text)
                if enriched_text.strip():
                    analysis_src.write_text(enriched_text, encoding="utf-8")
                    analysis_dst.write_text(enriched_text, encoding="utf-8")
                    regular_text = enriched_text.strip()
        except Exception as signal_snapshot_err:
            notes.append(f"Dashboard signal snapshot append failed: {signal_snapshot_err}")
    except Exception as dashboard_err:
        notes.append(f"Dashboard JSON generation failed: {dashboard_err}")

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
            analysis_has_prices_section = f"# {ticker} Prices Explain" in analysis_text_for_pdf
            if prices_explain_txt.exists() and not analysis_has_prices_section:
                merged_parts.append(prices_explain_txt.read_text(encoding="utf-8"))

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

    store = get_artifact_store()
    artifact_local_paths: Dict[str, Path] = {
        "analysis-txt": analysis_dst,
        "analysis-pdf": Path(pdf_dst) if pdf_dst else None,
        "prices-explain-txt": prices_explain_txt,
        "prices-explain-pdf": Path(prices_explain_pdf) if prices_explain_pdf else None,
        "dashboard-json": Path(dashboard_json) if dashboard_json else None,
        "prices-chart": out_dir / f"{ticker}_prices_valuation.png",
        "revenue-chart": out_dir / f"{ticker}_revenue_valuation.png",
        "net-income-chart": out_dir / f"{ticker}_net_income_valuation.png",
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
        dashboard_json=dashboard_json,
        notes=notes,
        current_revenue=current_revenue,
        target_revenue=target_revenue,
        current_earnings=current_earnings,
        target_earnings=target_earnings,
        f_score_text=f_score_text,
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
        "dashboard_json": artifacts.dashboard_json,
        "notes": artifacts.notes,
        "current_revenue": artifacts.current_revenue,
        "target_revenue": artifacts.target_revenue,
        "current_earnings": artifacts.current_earnings,
        "target_earnings": artifacts.target_earnings,
        "f_score_text": artifacts.f_score_text,
        "analysis_duration_minutes": round((time.perf_counter() - run_started) / 60.0, 2),
        "sec_fallback_used": artifacts.sec_fallback_used,
        "sec_fallback_message": artifacts.sec_fallback_message,
        "r2_keys": artifacts.r2_keys,
    }
