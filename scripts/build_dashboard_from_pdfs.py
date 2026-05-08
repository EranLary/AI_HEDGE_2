from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from pypdf import PdfReader
import yfinance as yf


METHOD_ORDER = [
    "DCF",
    "Net Income & P/E",
    "Revenue & EV/S",
    "Dream Team",
    "BBB Target",
    "BBB NI & P/E",
    "Lary's Logic",
]

METHOD_NAME_ALIASES = {
    "dcf": "DCF",
    "net income & p/e": "Net Income & P/E",
    "revenue & ev/s": "Revenue & EV/S",
    "dream team": "Dream Team",
    "bbb target": "BBB Target",
    "bbb ni & p/e": "BBB NI & P/E",
    "lary's logic": "Lary's Logic",
    "larys logic": "Lary's Logic",
}


def _safe_latest_close(symbol: str) -> Optional[float]:
    try:
        hist = yf.Ticker(symbol).history(period="1mo")
    except Exception:
        return None
    if hist is None or getattr(hist, "empty", True):
        return None
    try:
        close = hist["Close"].dropna()
    except Exception:
        return None
    if close.empty:
        return None
    value = _to_float(close.iloc[-1])
    if value is None or value <= 0:
        return None
    return float(value)


def _resolve_price_currency_context(ticker: str, analysis_text: str = "") -> Dict[str, Any]:
    ticker_u = str(ticker or "").strip().upper()
    if not ticker_u.endswith(".TA"):
        return {
            "currency": "USD",
            "original_price_currency": "USD",
            "original_financial_currency": "USD",
            "price_currency_to_USD": 1.0,
            "financial_currency_to_USD": 1.0,
        }

    parsed_rate = None
    m = re.search(r"Currency\s*:\s*([0-9]+(?:\.[0-9]+)?)", str(analysis_text or ""), re.IGNORECASE)
    if m:
        parsed_rate = _to_float(m.group(1))

    usd_per_ils = None
    if isinstance(parsed_rate, (int, float)) and parsed_rate > 0:
        # In legacy STRS artifacts this is typically ILS-per-USD (e.g. 2.9828).
        # If it arrives in agorot scale, normalize back to ILS-per-USD.
        usd_per_ils = float(parsed_rate / 100.0) if parsed_rate > 20 else float(parsed_rate)

    if usd_per_ils is None:
        usd_per_ils = _safe_latest_close("ILS=X")
    if usd_per_ils is None:
        usd_per_ils = 3.5

    # ILA (agorot) multiplier: USD -> agorot equals USD/ILS * 100
    return {
        "currency": "USD",
        "original_price_currency": "ILA",
        "original_financial_currency": "ILS",
        "price_currency_to_USD": float(usd_per_ils * 100.0),
        "financial_currency_to_USD": float(usd_per_ils),
    }


def _to_float(value: Any) -> Optional[float]:
    raw = str(value or "").strip()
    if not raw:
        return None
    if re.search(r"\bN\s*/?\s*A\b", raw, re.IGNORECASE):
        return None
    raw = raw.replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        return float(raw)
    except Exception:
        m = re.search(r"-?\d+(?:\.\d+)?", raw)
        if not m:
            return None
        try:
            return float(m.group(0))
        except Exception:
            return None


def _safe_line(line: str) -> str:
    out = unicodedata.normalize("NFKC", str(line or ""))
    out = out.replace("\x00", "")
    out = out.replace("\u200b", "")
    out = out.replace("\u2022", "- ")
    out = out.replace("\u25cf", "- ")
    out = out.replace("\u25e6", "- ")
    out = out.replace("\uf0b7", "- ")
    out = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", out)
    out = re.sub(r"[ \t]+", " ", out)
    return out.strip()


def _is_noise_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if s in {"(", ")", "\x22", "\x27"}:
        return True
    if len(s) <= 8 and not re.search(r"[A-Za-z0-9]", s):
        return True
    non_ascii = sum(1 for ch in s if ord(ch) > 127)
    if len(s) <= 10 and non_ascii / max(1, len(s)) > 0.5:
        return True
    return False


def _clean_pdf_text(text: str) -> str:
    raw = unicodedata.normalize("NFKC", str(text or "")).replace("\x00", "")
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    lines: List[str] = []
    for line in raw.splitlines():
        cleaned = _safe_line(line)
        if _is_noise_line(cleaned):
            continue
        lines.append(cleaned)

    merged = "\n".join(lines)
    merged = re.sub(r"\n{3,}", "\n\n", merged)
    return merged.strip()


def _extract_text_from_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    pages: List[str] = []
    for page in reader.pages:
        try:
            txt = page.extract_text() or ""
        except Exception:
            txt = ""
        cleaned = _clean_pdf_text(txt)
        if cleaned:
            pages.append(cleaned)
    return "\n\n".join(pages).strip()


def _loose_phrase_pattern(phrase: str) -> str:
    parts = []
    for token in phrase.split():
        chars = [re.escape(ch) for ch in token]
        parts.append(r"\s*".join(chars))
    return r"\s+".join(parts)


def _extract_number_field(text: str, label: str, stop_labels: Optional[List[str]] = None) -> Optional[float]:
    stops = stop_labels or []
    stop_regex_parts = [_loose_phrase_pattern(s) + r"\s*:" for s in stops]
    stop_regex = r"|".join(stop_regex_parts + [r"[\r\n]"])
    pattern = _loose_phrase_pattern(label) + r"\s*:\s*([\s\S]*?)(?=(?:" + stop_regex + r"|$))"
    m = re.search(pattern, text, re.IGNORECASE)
    if not m:
        return None
    return _to_float(m.group(1))


def _extract_lmil(text: str) -> Optional[List[float]]:
    m = re.search(
        r"LMIL\s*:\s*\[\s*([-+]?\d+(?:\.\d+)?)\s*%?\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\]",
        text,
        re.IGNORECASE,
    )
    if not m:
        return None
    a = _to_float(m.group(1))
    b = _to_float(m.group(2))
    if a is None or b is None:
        return None
    return [float(a), float(b)]


def _canonical_method_name(raw: str) -> str:
    key = re.sub(r"\s+", " ", str(raw or "")).strip().lower()
    key = key.replace("’", "'")
    return METHOD_NAME_ALIASES.get(key, str(raw or "").strip())


def _split_method_chunks(prices_text: str) -> Dict[str, str]:
    pat = re.compile(
        r"(?mi)^\s*(DCF|Net Income\s*&\s*P/E|Revenue\s*&\s*EV/S|Dream Team|BBB Target|BBB NI\s*&\s*P/E|Lary['’]?s Logic)\s*$"
    )
    matches = list(pat.finditer(prices_text))
    chunks: Dict[str, str] = {}
    for i, m in enumerate(matches):
        name = _canonical_method_name(m.group(1))
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(prices_text)
        chunk = prices_text[start:end].strip()
        if chunk:
            chunks[name] = chunk
    return chunks


def _extract_section(text: str, start_pat: str, end_pat: str) -> str:
    m = re.search(start_pat + r"([\s\S]*?)" + end_pat, text, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _normalize_metric_path(path: str) -> str:
    p = str(path or "").strip()
    p = re.sub(r"\s+", "_", p)
    p = re.sub(r"[^A-Za-z0-9_\[\]\./-]+", "", p)
    p = p.replace("-", "_")
    p = re.sub(r"_+", "_", p).strip("_")
    if p.lower() == "wacc":
        return "WACC"
    if p.lower() == "terminal":
        return "TERMINAL"
    return p or "value"


def _normalize_metric_key(metric_path: str) -> str:
    metric_path = str(metric_path or "").strip()
    if not metric_path:
        return "value"
    leaf = metric_path.split(".")[-1]
    leaf = leaf.replace("[", "_").replace("]", "")
    leaf = re.sub(r"[^a-zA-Z0-9_]+", "_", leaf)
    leaf = re.sub(r"_+", "_", leaf).strip("_")
    return (leaf.lower() or "value")


def _append_metric_to_raw(raw_json: Dict[str, Any], metric_path: str, value: float) -> None:
    idx_match = re.match(r"^([A-Za-z0-9_./-]+)\[(\d+)\]$", metric_path)
    if idx_match:
        base = idx_match.group(1)
        idx = int(idx_match.group(2))
        existing = raw_json.get(base)
        if not isinstance(existing, list):
            existing = []
            raw_json[base] = existing
        while len(existing) <= idx:
            existing.append(None)
        existing[idx] = float(value)
        return
    raw_json[metric_path] = float(value)


def _parse_reason_sections(output_text: str) -> List[Dict[str, str]]:
    text = _clean_pdf_text(output_text)
    marker = re.search(_loose_phrase_pattern("Step-by-Step and Rationale"), text, re.IGNORECASE)
    body = text[marker.end() :] if marker else text
    body = body.strip()
    if not body:
        return []

    step_marker = re.search(r"(?mi)^\s*step\s*by\s*step\s*analysis\s*$", body)
    if step_marker:
        body = body[step_marker.end() :].strip()

    heading_re = re.compile(r"(?mi)^\s*([A-Za-z][A-Za-z0-9 &/'\-]{1,70}\s+rationale)\s*$")
    headings = list(heading_re.finditer(body))
    sections: List[Dict[str, str]] = []

    if not headings:
        sections.append(
            {
                "path": "step_by_step_analysis",
                "label": "Step-by-Step Analysis",
                "text": body,
            }
        )
        return sections

    prefix = body[: headings[0].start()].strip()
    if prefix:
        sections.append(
            {
                "path": "step_by_step_analysis",
                "label": "Step-by-Step Analysis",
                "text": prefix,
            }
        )

    for i, m in enumerate(headings):
        title = str(m.group(1) or "").strip()
        start = m.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(body)
        chunk = body[start:end].strip()
        if not chunk:
            continue
        path = re.sub(r"[^a-z0-9_]+", "_", title.lower()).strip("_")
        sections.append({"path": path or "rationale", "label": title, "text": chunk})

    return sections


def _parse_key_numeric_values(output_text: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    section = _extract_section(
        output_text,
        _loose_phrase_pattern("Key Numeric Values") + r"\s*",
        r"(?:"
        + _loose_phrase_pattern("Step-by-Step and Rationale")
        + r"|"
        + _loose_phrase_pattern("Output")
        + r"\s+\d+|$)",
    )
    rows: List[Dict[str, Any]] = []
    raw_json: Dict[str, Any] = {}

    if not section:
        return rows, raw_json

    for line in section.splitlines():
        s = _safe_line(line).strip("- ").strip()
        if ":" not in s:
            continue
        key, val = s.split(":", 1)
        metric_path = _normalize_metric_path(key)
        num = _to_float(val)
        if num is None:
            continue
        metric_key = _normalize_metric_key(metric_path)
        rows.append(
            {
                "path": metric_path,
                "metric_key": metric_key,
                "label": metric_key.replace("_", " ").title(),
                "value": float(num),
            }
        )
        _append_metric_to_raw(raw_json, metric_path, float(num))
    return rows, raw_json


def _parse_output_chunks(method_chunk: str) -> List[Tuple[int, str, str]]:
    pat = re.compile(r"(?mi)^\s*Output\s+(\d+)(?:\s*\(([^)]+)\))?\s*$")
    matches = list(pat.finditer(method_chunk))
    out: List[Tuple[int, str, str]] = []
    for i, m in enumerate(matches):
        idx = int(m.group(1))
        persona = str(m.group(2) or "").strip()
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(method_chunk)
        out.append((idx, persona, method_chunk[start:end].strip()))
    return out


def parse_prices_explain_text(ticker: str, prices_text: str) -> Dict[str, Any]:
    cleaned = _clean_pdf_text(prices_text)
    current_price = _extract_number_field(cleaned, "Current Price")

    methods: Dict[str, List[Dict[str, Any]]] = {}
    aggregate_targets: Dict[str, Optional[float]] = {}
    aggregate_investments: Dict[str, Optional[float]] = {}

    method_chunks = _split_method_chunks(cleaned)
    for method_name in METHOD_ORDER:
        chunk = method_chunks.get(method_name, "")
        if not chunk:
            methods[method_name] = []
            aggregate_targets[method_name] = None
            aggregate_investments[method_name] = None
            continue

        method_target = _extract_number_field(
            chunk,
            "Method Target Price",
            stop_labels=["Method Mean Investment", "Captured Outputs"],
        )
        method_investment = _extract_number_field(
            chunk,
            "Method Mean Investment",
            stop_labels=["Captured Outputs", "Output"],
        )

        outputs: List[Dict[str, Any]] = []
        for _idx, persona, output_chunk in _parse_output_chunks(chunk):
            output_target = _extract_number_field(
                output_chunk,
                "Output Target Price",
                stop_labels=["Output Investment Amount", "Key Numeric Values"],
            )
            output_investment = _extract_number_field(
                output_chunk,
                "Output Investment Amount",
                stop_labels=["Key Numeric Values", "Step-by-Step and Rationale"],
            )
            key_numeric_values, raw_json = _parse_key_numeric_values(output_chunk)
            reason_sections = _parse_reason_sections(output_chunk)
            for section in reason_sections:
                path = str(section.get("path", "")).strip()
                txt = str(section.get("text", "")).strip()
                if path and txt and path not in raw_json:
                    raw_json[path] = txt
            if reason_sections and "step_by_step_analysis" not in raw_json:
                raw_json["step_by_step_analysis"] = "\n\n".join(rs["text"] for rs in reason_sections[:3])

            outputs.append(
                {
                    "persona": persona,
                    "target_price": output_target,
                    "investment_amount": output_investment,
                    "raw_json_text": json.dumps(raw_json, ensure_ascii=False),
                    "raw_json": raw_json,
                    "key_numeric_values": key_numeric_values,
                    "reason_sections": reason_sections,
                }
            )

        if method_target is None:
            vals = [float(o["target_price"]) for o in outputs if isinstance(o.get("target_price"), (int, float))]
            if vals:
                method_target = float(np.mean(vals))
        if method_investment is None:
            vals = [
                float(o["investment_amount"])
                for o in outputs
                if isinstance(o.get("investment_amount"), (int, float))
            ]
            if vals:
                method_investment = float(np.mean(vals))

        methods[method_name] = outputs
        aggregate_targets[method_name] = method_target
        aggregate_investments[method_name] = method_investment

    all_targets = [float(v) for v in aggregate_targets.values() if isinstance(v, (int, float))]
    all_investments = [
        float(item.get("investment_amount"))
        for items in methods.values()
        for item in items
        if isinstance(item.get("investment_amount"), (int, float))
    ]
    mean_investment = float(np.mean(all_investments)) if all_investments else _extract_number_field(
        cleaned,
        "Mean Investment Amount",
        stop_labels=["Investment STD", "LMIL"],
    )
    std_investment = float(np.std(all_investments)) if all_investments else _extract_number_field(
        cleaned,
        "Investment STD",
        stop_labels=["LMIL"],
    )

    mean_investment = float(mean_investment) if isinstance(mean_investment, (int, float)) else 0.0
    std_investment = float(std_investment) if isinstance(std_investment, (int, float)) else 0.0
    lmil = _extract_lmil(cleaned)
    if not lmil:
        lmil = [
            (mean_investment / 100000.0) * 100.0,
            (std_investment / mean_investment) if abs(mean_investment) > 1e-9 else 0.0,
        ]

    return {
        "ticker": ticker,
        "current_price": current_price,
        "methods": methods,
        "aggregate_targets": aggregate_targets,
        "aggregate_investments": aggregate_investments,
        "all_investments": all_investments,
        "mean_investment": mean_investment,
        "investment_std": std_investment,
        "lmil": lmil,
        "all_targets": all_targets,
    }


def _parse_f_score_text(analysis_text: str) -> str:
    m = re.search(r"(The company has a Piotroski F-Score[\s\S]{0,1200})", analysis_text, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _dedupe(items: List[str], max_items: int) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        txt = _safe_line(item)
        if len(txt) < 20:
            continue
        if re.match(r"^[a-z]\s+rationale\b", txt.lower()):
            continue
        if txt.lower().startswith("risk-free rate is"):
            continue
        key = txt.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(txt)
        if len(out) >= max_items:
            break
    return out


def _split_sentences(text: str) -> List[str]:
    flattened = re.sub(r"\s+", " ", str(text or "")).strip()
    if not flattened:
        return []
    parts = re.split(r"(?<=[\.\?!])\s+", flattened)
    return [p.strip() for p in parts if len(p.strip()) >= 30]


def _clean_reason_block(text: str) -> str:
    cleaned = _clean_pdf_text(text)
    cleaned = re.sub(r"(?mi)^\s*[a-z][a-z0-9 &/'\-]{0,40}\s+rationale\s*$", "", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _build_pdf_heuristic_sections(
    ticker: str,
    analysis_text: str,
    prices_text: str,
    explain_payload: Dict[str, Any],
) -> Dict[str, Any]:
    analysis_clean = _clean_pdf_text(analysis_text)
    prices_clean = _clean_pdf_text(prices_text)

    model_chunks: List[str] = []
    methods = explain_payload.get("methods", {}) if isinstance(explain_payload, dict) else {}
    if isinstance(methods, dict):
        for method_name in METHOD_ORDER:
            items = methods.get(method_name, [])
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                raw = item.get("raw_json", {})
                if not isinstance(raw, dict):
                    continue
                step = _clean_reason_block(str(raw.get("step_by_step_analysis", "") or ""))
                if len(step) > 60:
                    model_chunks.append(step)
                for key, value in raw.items():
                    k = str(key or "").lower()
                    if "rationale" in k:
                        txt = _clean_reason_block(str(value or ""))
                        if len(txt) > 40:
                            model_chunks.append(txt)

    model_text = "\n\n".join(model_chunks)
    merged_text = (model_text + "\n\n" + prices_clean + "\n\n" + analysis_clean).strip()
    candidate_lines = _split_sentences(model_text if model_text else merged_text)

    neg_kws = ("risk", "dilution", "burn", "loss", "decline", "debt", "pressure", "weak", "volatility")
    pos_kws = ("growth", "improve", "advantage", "partnership", "runway", "liquidity", "opportunity", "moat")
    opp_kws = ("ai", "market", "commercial", "partnership", "catalyst", "adoption", "tailwind", "expansion")

    red = _dedupe([x for x in candidate_lines if any(k in x.lower() for k in neg_kws)], 12)
    bull = _dedupe([x for x in candidate_lines if any(k in x.lower() for k in pos_kws)], 10)
    key = _dedupe(candidate_lines, 12)

    weaknesses = _dedupe([x for x in candidate_lines if any(k in x.lower() for k in ("loss", "burn", "dilution", "weak", "unproven"))], 6)
    opportunities = _dedupe([x for x in candidate_lines if any(k in x.lower() for k in opp_kws)], 6)
    strengths = bull[:6] if bull else _dedupe([x for x in candidate_lines if "strong" in x.lower() or "liquidity" in x.lower()], 6)
    threats = red[:6]

    summary_chunks = [chunk for chunk in model_chunks if len(chunk) > 120][:6]
    if not summary_chunks:
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", prices_clean) if p.strip()]
        if not paragraphs:
            paragraphs = [p.strip() for p in re.split(r"\n\s*\n", analysis_clean) if p.strip()]
        summary_chunks = [p for p in paragraphs if len(p) > 120][:8]
    executive_summary = "\n\n".join(summary_chunks)[:7000] if summary_chunks else merged_text[:7000]
    if not executive_summary:
        executive_summary = "No analysis text was extracted from the uploaded PDF."

    if not key:
        key = ["Key insights could not be extracted reliably from the uploaded PDF text."]
    if not red:
        red = ["No clear red-flag bullets were detected from PDF text extraction."]
    if not strengths:
        strengths = ["No clear strengths were extracted; this usually means the PDF text was noisy."]

    documents = {
        "executive_summary": {
            "company": ticker,
            "document_type": "executive_summary",
            "executive_summary": executive_summary,
            "key_takeaways": key[:5],
        },
        "key_points": {
            "company": ticker,
            "document_type": "key_points_bullets",
            "important_points": key[:8],
        },
        "swot": {
            "company": ticker,
            "document_type": "swot_bullets",
            "strengths": strengths[:6],
            "weaknesses": weaknesses[:6],
            "opportunities": opportunities[:6],
            "threats": threats[:6],
        },
        "red_flags": {
            "company": ticker,
            "document_type": "red_flags_bullets",
            "red_flags": red[:10],
        },
    }

    return {
        "documents": documents,
        "executive_summary_markdown": executive_summary,
        "key_insights": key[:12],
        "bull_insights": bull[:10],
        "red_flags": red[:10],
        "swot": {
            "strengths": strengths[:6],
            "weaknesses": weaknesses[:6],
            "opportunities": opportunities[:6],
            "threats": threats[:6],
        },
        "source": "pdf_heuristic",
    }


def build_from_pdfs(
    *,
    ticker: str,
    analysis_pdf: Path,
    prices_pdf: Path,
    output_root: Path,
) -> Dict[str, Any]:
    from ai_hedge.dashboard import (
        build_dashboard_appendix_text,
        build_dashboard_payload,
        generate_dashboard_sections,
        write_dashboard_payload,
    )

    out_dir = output_root / ticker.upper().strip()
    out_dir.mkdir(parents=True, exist_ok=True)

    analysis_text = _extract_text_from_pdf(analysis_pdf)
    prices_text = _extract_text_from_pdf(prices_pdf)

    explain_payload = parse_prices_explain_text(ticker, prices_text)
    currency_ctx = _resolve_price_currency_context(ticker, analysis_text=analysis_text)
    price_multiplier = _to_float(currency_ctx.get("price_currency_to_USD")) or 1.0
    current_price = explain_payload.get("current_price")
    all_targets = explain_payload.get("all_targets", [])
    target_mean = float(np.mean(all_targets)) if all_targets else None
    target_std = float(np.std(all_targets)) if all_targets else None
    if isinstance(target_mean, (int, float)) and price_multiplier > 0 and str(ticker).upper().endswith(".TA"):
        target_mean = float(target_mean) * float(price_multiplier)
    if isinstance(target_std, (int, float)) and price_multiplier > 0 and str(ticker).upper().endswith(".TA"):
        target_std = float(target_std) * float(price_multiplier)
    cv = None
    if isinstance(current_price, (int, float)) and isinstance(target_mean, (int, float)):
        denom = (float(current_price) + float(target_mean)) / 2.0
        if abs(denom) > 1e-9 and isinstance(target_std, (int, float)):
            cv = float(target_std / denom)

    final_dict = {
        "Prices": {
            "Current": current_price,
            "Overall": [target_mean, target_mean],
            "STD": target_std,
            "CV": cv,
            "LMIL": explain_payload.get("lmil", [0.0, 0.0]),
            "LMIL Mean Investment": explain_payload.get("mean_investment", 0.0),
            "LMIL Investment STD": explain_payload.get("investment_std", 0.0),
        },
        "Revenue": {"Current": None, "Overall": [None, None], "STD": None},
        "Net Income": {"Current": None, "Overall": [None, None], "STD": None},
        "P/E": {"Current": None, "Overall": [None, None], "STD": None},
    }

    variables_dict = {
        "price": current_price,
        "market_cap": None,
        "shares_outstanding": None,
        "f_score": _parse_f_score_text(analysis_text),
    }
    info_dict = {
        "info": {
            "shortName": ticker,
            "longName": ticker,
            "currency": "USD",
            **currency_ctx,
        },
        "change": 0,
    }
    financial_dict = {
        "All Reports": "",
        "currency_statement": "",
        "info_financials": "",
    }

    qualitative = generate_dashboard_sections(
        ticker=ticker,
        analysis_text=analysis_text,
        sec_short_text="",
        financial_dict=financial_dict,
        deterministic_red_flags=[],
        enable_llm_extractions=True,
    )
    if str(qualitative.get("source", "")).strip().lower() in {"fallback", "disabled"}:
        qualitative = _build_pdf_heuristic_sections(ticker, analysis_text, prices_text, explain_payload)

    appendix_text = build_dashboard_appendix_text(ticker, qualitative)
    analysis_with_appendix = analysis_text.rstrip() + "\n\n" + appendix_text

    analysis_txt_path = out_dir / f"{ticker}_analysis.txt"
    prices_txt_path = out_dir / f"{ticker}_prices_explain.txt"
    analysis_txt_path.write_text(analysis_with_appendix, encoding="utf-8")
    prices_txt_path.write_text(prices_text, encoding="utf-8")

    payload = build_dashboard_payload(
        ticker=ticker,
        info_dict=info_dict,
        financial_dict=financial_dict,
        variables_dict=variables_dict,
        final_dict=final_dict,
        explain_payload=explain_payload,
        analysis_text=analysis_with_appendix,
        sec_short_text="",
        artifacts={
            "analysis_txt": str(analysis_txt_path.resolve()),
            "prices_explain_txt": str(prices_txt_path.resolve()),
            "analysis_pdf": str(analysis_pdf.resolve()),
            "prices_explain_pdf": str(prices_pdf.resolve()),
        },
        qualitative_sections=qualitative,
        enable_llm_extractions=True,
    )
    dashboard_json_path = write_dashboard_payload(out_dir / f"{ticker}_dashboard.json", payload)
    return {
        "ticker": ticker,
        "dashboard_json": dashboard_json_path,
        "analysis_txt": str(analysis_txt_path.resolve()),
        "prices_explain_txt": str(prices_txt_path.resolve()),
        "output_dir": str(out_dir.resolve()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build dashboard JSON from analysis/prices PDF files.")
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--analysis-pdf", required=True)
    parser.add_argument("--prices-pdf", required=True)
    parser.add_argument("--output-root", default="outputs")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    src = root / "src"
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))

    ticker = str(args.ticker or "").strip().upper()
    if not ticker:
        raise ValueError("Ticker is required.")

    analysis_pdf = Path(args.analysis_pdf).resolve()
    prices_pdf = Path(args.prices_pdf).resolve()
    if not analysis_pdf.exists():
        raise FileNotFoundError(f"Analysis PDF not found: {analysis_pdf}")
    if not prices_pdf.exists():
        raise FileNotFoundError(f"Prices PDF not found: {prices_pdf}")

    output_root = Path(args.output_root).resolve()
    out = build_from_pdfs(
        ticker=ticker,
        analysis_pdf=analysis_pdf,
        prices_pdf=prices_pdf,
        output_root=output_root,
    )
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
