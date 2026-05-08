from __future__ import annotations

import json
import os
import shutil
import traceback
from pathlib import Path
from re import compile as re_compile
from typing import Any, Dict, List, Tuple

TICKER_REGEX = re_compile(r"^[A-Z0-9\.\-]{1,10}$")


def is_valid_ticker(ticker: str) -> bool:
    """Validate ticker format for API-facing requests."""
    return bool(TICKER_REGEX.fullmatch((ticker or "").strip().upper()))


def _copy_artifact(source: Path, target: Path) -> bool:
    """Copy artifact to target path if source exists."""
    if not source.exists() or not source.is_file():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() != target.resolve():
        shutil.copy2(source, target)
    return True


def _ensure_deepseek_api_key() -> None:
    """Load DEEPSEEK_API_KEY from project .env if missing in current process."""
    if os.getenv("DEEPSEEK_API_KEY", "").strip():
        return

    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().lstrip("\ufeff")
        if key != "DEEPSEEK_API_KEY":
            continue
        val = value.strip().strip('"').strip("'").strip()
        if val:
            os.environ["DEEPSEEK_API_KEY"] = val
        return


SEC_SHARED_PREFIX = """
You are a senior Buy-Side equity analyst at a top-tier investment fund.

You specialize in:
- Deep fundamental analysis
- Financial statement interpretation (10-K, 10-Q, footnotes)
- Detecting earnings quality issues and accounting distortions
- Competitive positioning and industry structure
- Valuation under uncertainty

Your job is NOT to summarize, your job is to THINK.

You are expected to:
- Decompose the business into its economic drivers
- Identify what truly drives revenue, margins, and capital intensity
- Distinguish signal from noise
- Challenge management narratives and detect optimism bias
- Connect financial data, then business reality, then valuation implications

Critical Data Constraint:
- Use ONLY the provided inputs (info dict, financials, SEC filings).
- Do NOT use prior knowledge.
- If something is missing, write EXACTLY:
  "Not disclosed in the provided filings."

Analytical Principles:
- Every claim must be grounded in data or explicitly labeled as inference
- Always prefer economic reality over accounting presentation
- Focus on material drivers, not trivial details
- Avoid generic statements (e.g., "strong growth", "competitive market") unless quantified or justified

Skepticism Mandate:
- Assume management may present an overly favorable view
- Look for inconsistencies between:
  - Narrative vs numbers
  - Growth vs cash flow
  - Earnings vs dilution or capital intensity

Writing Style:
- Direct, analytical, and evidence-based
- No fluff, no marketing language
- No repetition
- Use structured reasoning

Time Context:
- ALWAYS reference the relevant year/quarter when mentioning financial data
""".strip()


SEC_PART_1_SECTIONS = """
Produce ONLY sections 1-7:

1) Understanding the Business in Plain Terms
- Explain what the company actually does in simple terms
- How it makes money (real-world explanation, not corporate jargon)
- What problem it solves and for whom
- Key revenue streams (rank by importance if possible)

2) The Business Model (Economic Engine)
- Revenue model (one-time vs recurring, pricing logic, drivers)
- Cost structure (fixed vs variable, key cost drivers)
- Margin structure and what drives it
- Capital intensity (does it require heavy reinvestment?)
- Operating leverage: when and how margins expand or compress

3) Deep Financial Analysis
- Revenue growth (multi-period, trend, volatility)
- Profitability (gross, operating, net margins - trend over time)
- Cash flow vs earnings (quality of earnings)
- Balance sheet strength (debt, liquidity, risks)
- Share dilution / buybacks (capital allocation signals)
- Identify key inflection points or anomalies in financials

4) Notes to the Financial Statements (Footnotes Analysis)
- Revenue recognition policies (any aggressive assumptions?)
- Stock-based compensation (magnitude and trend)
- One-time items vs recurring earnings
- Off-balance sheet risks or hidden liabilities
- Segment reporting insights (if available)
- Any accounting red flags or complexity

5) Market and Competitive Environment
- Industry structure (fragmented vs concentrated)
- Company positioning within the market
- Key competitors (if mentioned or implied)
- Barriers to entry (real vs perceived)
- Where the company sits in the value chain

6) Industry-Critical Metrics
- Identify the 3-6 MOST important KPIs for this industry
- Build a table:

KPI | Company Performance | Interpretation
----|---------------------|---------------
[metric] | [value/trend] | [what it actually means economically]

- Focus on metrics that truly drive valuation (not vanity metrics)

7) Valuation and Relative Positioning
- Any valuation hints from the data (multiples, margins, growth vs peers)
- Is the company structurally high-quality or not?
- What kind of multiple profile would this business deserve (qualitatively)
- Identify what would justify a premium vs discount
""".strip()


SEC_PART_2_SECTIONS = """
Produce ONLY sections 8-16:

8) Competitive Advantage (Moat)
- Does the company have a real moat? (Yes / No / Weak)
- Source of advantage (if any): scale, switching costs, brand, tech, regulation
- Durability of that advantage over time
- Evidence from financials (not just narrative)

9) The Stock vs The Business
- Is there a disconnect between business quality and implied expectations?
- What must be true for the stock to be attractive?
- What expectations seem embedded in the current trajectory?

10) Customers and Suppliers
- Customer concentration (if disclosed)
- Dependency risks (key customers or suppliers)
- Pricing power vs customer bargaining power
- Any structural dependency that could impact margins

11) Management, Ownership, and Incentives
- Insider ownership (alignment or not)
- Capital allocation behavior (buybacks, dilution, M&A)
- Compensation signals (especially stock-based comp)
- Any signs of short-termism or empire-building

12) Major Strategic Events
- Identify major events and their impact:

Event | Date | Strategic Impact
------|------|-----------------
[event] | [date] | [why it matters economically]

13) Opportunities and Risks
- Key upside drivers (specific, not generic)
- Structural risks to the business model
- Execution risks
- Explicitly answer:
  What realistic scenario could lead to a 50% decline in value?

14) SWOT Analysis

Strengths:
- [...]

Weaknesses:
- [...]

Opportunities:
- [...]

Threats:
- [...]

15) Key Metrics to Track Going Forward
- Define the 5-7 MOST critical forward-looking KPIs
- These should be leading indicators, not lagging ones
- Each metric must connect to valuation impact

16) Forensic Section: What Might Management Be Hiding?
- Identify areas where reality may differ from reported numbers
- Aggressive accounting signals (if any)
- Mismatch between narrative and financials
- Where should an investor dig deeper?
- What is NOT being clearly disclosed but should be questioned?
""".strip()


def _truncate_text(value: Any, max_chars: int) -> str:
    text = str(value or "")
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def _build_sec_text_payload(files_dict: Dict[str, object]) -> Tuple[str, List[str]]:
    """
    Build SEC text-only context from files_dict (no tables).

    Returns:
        (combined_text, notes)
    """
    def _classify_filing_kind(form_type: str, raw: Dict[str, Any]) -> str:
        form_u = str(form_type or "").strip().upper()
        title_u = str(raw.get("title", "") or "").strip().upper()
        joined = f"{form_u} {title_u}"

        if any(k in joined for k in ("10-K", "20-F", "MAYA ANNUAL", "ANNUAL")):
            return "annual"
        if any(k in joined for k in ("10-Q", "6-K", "MAYA QUARTERLY", "QUARTER", "Q1", "Q2", "Q3", "Q4")):
            return "quarterly"
        return "other"

    notes: List[str] = []
    chunks: List[str] = []
    total_budget = 500_000
    entries: List[Tuple[str, Dict[str, Any], str, str, str]] = []

    for form_type, raw in (files_dict or {}).items():
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "")
        if not text.strip():
            continue
        date = str(raw.get("date") or "")
        kind = _classify_filing_kind(str(form_type or ""), raw)
        entries.append((str(form_type), raw, text, date, kind))

    quarterly_entries = [e for e in entries if e[4] == "quarterly"]
    annual_entries = [e for e in entries if e[4] == "annual"]
    other_entries = [e for e in entries if e[4] == "other"]

    # Requested policy:
    # - Quarterly should not be truncated.
    # - Annual budget is (500k - quarterly_chars).
    # - If no quarterly exists, annual budget is full 500k.
    quarterly_text_chars = sum(len(e[2]) for e in quarterly_entries)
    annual_budget = max(0, total_budget - quarterly_text_chars) if quarterly_entries else total_budget
    annual_budget_left = annual_budget

    def _append_block(form_type: str, date: str, text: str) -> None:
        header = f"## Filing: {form_type} | Date: {date}".strip()
        chunks.append(f"{header}\n{text}")

    for form_type, _raw, text, date, _kind in quarterly_entries:
        _append_block(form_type, date, text)

    for form_type, _raw, text, date, _kind in annual_entries:
        if annual_budget_left <= 0:
            clipped = ""
        else:
            clipped = _truncate_text(text, annual_budget_left)
            annual_budget_left -= len(clipped)
        _append_block(form_type, date, clipped)

    # Keep other filings only as best effort within the remaining annual budget.
    for form_type, _raw, text, date, _kind in other_entries:
        if annual_budget_left <= 0:
            break
        clipped = _truncate_text(text, annual_budget_left)
        annual_budget_left -= len(clipped)
        _append_block(form_type, date, clipped)

    return "\n\n".join(chunks), notes
def _sec_style_instruction(short_mode: bool) -> str:
    if short_mode:
        return (
            "Output format constraints:\n"
            "- For EACH section, write only 5-10 bullet points.\n"
            "- No long paragraphs.\n"
            "- No intro or outro text.\n"
            "- Keep bullets short and high-signal.\n"
            "- Use markdown bullet syntax with '-' only.\n"
            "- Only bullet points, no paragraphs. Be concise and direct."
        )
    return (
        "Output format constraints:\n"
        "- Keep a structured section-by-section response.\n"
        "- Be concise but complete.\n"
        "- Include tables where requested."
    )


def _extract_bullet_content(line: str) -> str | None:
    stripped = (line or "").strip()
    if not stripped:
        return None

    for prefix in ("- ", "* ", "\u2022 "):
        if stripped.startswith(prefix):
            content = stripped[len(prefix):].strip()
            return content if content else None

    if stripped[:1] in {"-", "*", "\u2022"}:
        content = stripped[1:].strip()
        return content if content else None

    idx = 0
    while idx < len(stripped) and stripped[idx].isdigit():
        idx += 1
    if idx > 0 and idx < len(stripped) and stripped[idx] in {".", ")"}:
        content = stripped[idx + 1 :].strip()
        return content if content else None

    return None


def _looks_like_heading(line: str) -> bool:
    stripped = (line or "").strip()
    if not stripped:
        return False
    if stripped.startswith("#"):
        return True
    if stripped.endswith(":"):
        return True
    if stripped.lower().startswith("section "):
        return True
    return False


def _is_likely_bullet_continuation(line: str) -> bool:
    stripped = (line or "").strip()
    if not stripped:
        return False
    first = stripped[0]
    if first.islower():
        return True
    if first in {",", ";", ":", ")", "]"}:
        return True
    lower = stripped.lower()
    if lower.startswith(("and ", "or ", "but ", "with ", "including ", "which ", "that ")):
        return True
    return False


def _next_non_empty_line(lines: List[str], start_idx: int) -> str:
    i = start_idx + 1
    while i < len(lines):
        nxt = (lines[i] or "").strip()
        if nxt:
            return nxt
        i += 1
    return ""


def _looks_like_table_line(line: str) -> bool:
    stripped = (line or "").strip()
    if not stripped:
        return False
    if stripped.count("|") >= 2:
        return True
    return False


def _format_short_sec_output(answer: str) -> str:
    """
    Normalize SEC short output so each bullet is its own row with spacing.
    """
    lines = (answer or "").splitlines()
    out: List[str] = []

    for idx, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue

        bullet_content = _extract_bullet_content(line)
        if bullet_content is not None:
            if _looks_like_table_line(bullet_content):
                if out and out[-1] != "":
                    out.append("")
                if bullet_content.startswith("|"):
                    out.append(bullet_content)
                else:
                    out.append(f"| {bullet_content}")
                continue

            # If model puts heading and table header on the same bullet line, split it.
            if " | " in bullet_content and bullet_content.count("|") >= 2:
                left, right = bullet_content.split("|", 1)
                left = left.strip()
                right = right.strip()
                if left:
                    out.append(f"- {left}")
                    out.append("")
                if right:
                    out.append(f"| {right}")
                continue

            out.append(f"- {bullet_content}")
            out.append("")
            continue

        if _looks_like_heading(line):
            if out and out[-1] != "":
                out.append("")
            out.append(line)
            out.append("")
            continue

        if _looks_like_table_line(line):
            if out and out[-1] != "":
                out.append("")
            out.append(line)
            continue

        next_line = _next_non_empty_line(lines, idx)
        next_is_explicit_bullet = _extract_bullet_content(next_line) is not None
        if (
            len(out) >= 2
            and out[-1] == ""
            and out[-2].startswith("- ")
            and (
                _is_likely_bullet_continuation(line)
                or next_is_explicit_bullet
            )
        ):
            out[-2] = f"{out[-2]} {line}"
            continue

        out.append(f"- {line}")
        out.append("")

    return "\n".join(out).strip()


def _build_sec_prompt(
    *,
    ticker: str,
    info_text: str,
    all_reports_text: str,
    sec_text_bundle: str,
    part: int,
    short_mode: bool,
) -> str:
    section_block = SEC_PART_1_SECTIONS if part == 1 else SEC_PART_2_SECTIONS
    return (
        f"{SEC_SHARED_PREFIX}\n\n"
        f"{section_block}\n\n"
        f"{_sec_style_instruction(short_mode)}\n\n"
        f"Ticker: {ticker}\n\n"
        f"Info dict (info_dict['info']):\n{info_text}\n\n"
        f"Financial reports (financial_dict['all_reports'/'All Reports']):\n{all_reports_text}\n\n"
        f"SEC filings text (from files_dict, text only):\n{sec_text_bundle}\n"
    )


def _generate_sec_analysis_text(
    *,
    ticker: str,
    info_dict: Dict[str, Any],
    files_dict: Dict[str, Any],
    financial_dict: Dict[str, Any],
    short_mode: bool,
) -> Tuple[str, List[str]]:
    """
    Build SEC analysis text from already-fetched dicts.

    This is text-only and performs no file I/O.
    """
    errors: List[str] = []
    sec_text_bundle, notes = _build_sec_text_payload(files_dict)
    errors.extend(notes)
    if not sec_text_bundle.strip():
        errors.append("No SEC filing text available in files_dict.")
        return "", errors

    info_text = _truncate_text(json.dumps(info_dict.get("info", {}), ensure_ascii=False), 120_000)
    reports_value = financial_dict.get("all_reports", financial_dict.get("All Reports", ""))
    all_reports_text = _truncate_text(reports_value, 160_000)

    prompt_part_1 = _build_sec_prompt(
        ticker=ticker,
        info_text=info_text,
        all_reports_text=all_reports_text,
        sec_text_bundle=sec_text_bundle,
        part=1,
        short_mode=short_mode,
    )
    prompt_part_2 = _build_sec_prompt(
        ticker=ticker,
        info_text=info_text,
        all_reports_text=all_reports_text,
        sec_text_bundle=sec_text_bundle,
        part=2,
        short_mode=short_mode,
    )

    try:
        from . import legacy_port as legacy

        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        part_1_answer = legacy.deepseek_simple_text(
            api_key=api_key,
            prompt=prompt_part_1,
            model="deepseek-chat",
            temperature=0.35,
            short_answer=False,
        )
        part_2_answer = legacy.deepseek_simple_text(
            api_key=api_key,
            prompt=prompt_part_2,
            model="deepseek-chat",
            temperature=0.35,
            short_answer=False,
        )

        if short_mode:
            part_1_answer = _format_short_sec_output(part_1_answer)
            part_2_answer = _format_short_sec_output(part_2_answer)

        return f"{(part_1_answer or '').strip()}\n\n{(part_2_answer or '').strip()}".strip(), errors

    except Exception as exc:
        errors.append(f"Failed to generate SEC analysis text: {exc}")
        errors.append(traceback.format_exc(limit=3))
        return "", errors


def _parse_json_object_from_text(raw: str) -> Dict[str, Any]:
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    chunk = text[start : end + 1]
    try:
        parsed = json.loads(chunk)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _normalize_question_list(payload: Dict[str, Any]) -> List[str]:
    raw_questions = payload.get("questions", [])
    if not isinstance(raw_questions, list):
        return []
    out: List[str] = []
    seen = set()
    for item in raw_questions:
        question = str(item or "").strip()
        if not question:
            continue
        key = question.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(question)
        if len(out) >= 12:
            break
    return out


def _format_sec_qna_markdown(questions: List[str], answers_payload: Dict[str, Any]) -> str:
    answer_rows = answers_payload.get("answers", [])
    rows: List[Dict[str, Any]] = answer_rows if isinstance(answer_rows, list) else []
    lines: List[str] = [
        "## SEC Pre-Decision Q&A",
    ]

    lines.extend(["", "### Answers from SEC filings"])
    if not rows:
        lines.append("No SEC-based answers were generated.")
        return "\n".join(lines).strip()

    for idx, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        question = str(row.get("question", "") or "").strip()
        answer = str(row.get("answer", "") or "").strip()
        evidence = str(row.get("evidence", "") or "").strip()
        filing_refs = row.get("filing_refs", [])
        confidence = str(row.get("confidence", "") or "").strip()
        refs_text = ", ".join(str(x).strip() for x in filing_refs if str(x).strip()) if isinstance(filing_refs, list) else ""

        lines.append("")
        lines.append(f"{idx}. **Q:** {question or 'N/A'}")
        lines.append(f"   **A:** {answer or 'Not disclosed in the provided filings.'}")
        if evidence:
            lines.append(f"   **Evidence:** {evidence}")
        if refs_text:
            lines.append(f"   **Filing refs:** {refs_text}")
        if confidence:
            lines.append(f"   **Confidence:** {confidence}")

    return "\n".join(lines).strip()


def build_sec_question_answer_text(
    *,
    ticker: str,
    analysis_text: str,
    files_dict: Dict[str, Any],
    financial_dict: Dict[str, Any],
) -> Dict[str, object]:
    """
    Build SEC-focused questions from initial analysis + all reports, then answer them
    using SEC filing text. Returns markdown-ready Q&A text.
    """
    ticker_u = (ticker or "").strip().upper()
    errors: List[str] = []
    out: Dict[str, object] = {
        "status": "failed",
        "ticker": ticker_u,
        "text": "",
        "questions": [],
        "errors": errors,
    }

    if not is_valid_ticker(ticker_u):
        errors.append("Invalid ticker format. Expected [A-Z0-9.-]{1,10}.")
        return out

    try:
        _ensure_deepseek_api_key()
        from . import legacy_port as legacy

        sec_text_bundle, notes = _build_sec_text_payload(files_dict or {})
        errors.extend(notes)
        if not sec_text_bundle.strip():
            errors.append("No SEC filing text available in files_dict.")
            return out

        analysis_slice = _truncate_text(analysis_text, 150_000)
        reports_value = financial_dict.get("all_reports", financial_dict.get("All Reports", ""))
        all_reports_text = _truncate_text(reports_value, 160_000)

        questions_prompt = (
            "You are preparing final investment decision diligence.\n"
            "Given the first-pass analysis text and financial reports, list the most critical\n"
            "questions/information to verify directly in formal SEC filings BEFORE final decision.\n"
            "Focus on falsifiable, valuation-critical checks (earnings quality, cash conversion,\n"
            "segment economics, contingent liabilities, dilution, covenant/legal risk, concentration risk).\n\n"
            f"Ticker: {ticker_u}\n\n"
            "Return ONLY valid JSON in this exact shape:\n"
            "{\n"
            '  "questions": ["...", "..."]\n'
            "}\n"
            "Constraints:\n"
            "- 8 to 12 questions\n"
            "- One question per item\n"
            "- No markdown, no extra text.\n\n"
            f"Initial analysis text:\n{analysis_slice}\n\n"
            f"Financial reports (all_reports):\n{all_reports_text}\n"
        )

        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        raw_questions = legacy.deepseek_simple_text(
            api_key=api_key,
            prompt=questions_prompt,
            model="deepseek-reasoner",
            temperature=0.2,
            short_answer=False,
        )
        questions_obj = _parse_json_object_from_text(raw_questions)
        questions = _normalize_question_list(questions_obj)
        if not questions:
            errors.append("Failed to generate SEC verification questions.")
            return out

        questions_block = "\n".join(f"{idx}. {q}" for idx, q in enumerate(questions, start=1))
        answers_prompt = (
            "You are given SEC filing text and a diligence question list.\n"
            "Answer each question strictly from the provided SEC text.\n"
            'If unavailable, answer exactly: "Not disclosed in the provided filings."\n\n'
            "Return ONLY valid JSON in this exact shape:\n"
            "{\n"
            '  "answers": [\n'
            "    {\n"
            '      "question": "...",\n'
            '      "answer": "...",\n'
            '      "evidence": "brief quote/paraphrase from filing text",\n'
            '      "filing_refs": ["10-K 2024-02-10", "6-K 2025-11-04"],\n'
            '      "confidence": "High|Medium|Low"\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "No markdown, no extra keys, no prose outside JSON.\n\n"
            f"Questions:\n{questions_block}\n\n"
            f"SEC filings text:\n{sec_text_bundle}\n"
        )

        raw_answers = legacy.deepseek_simple_text(
            api_key=api_key,
            prompt=answers_prompt,
            model="deepseek-reasoner",
            temperature=0.15,
            short_answer=False,
        )
        answers_obj = _parse_json_object_from_text(raw_answers)
        qna_markdown = _format_sec_qna_markdown(questions, answers_obj)
        if not qna_markdown:
            errors.append("Failed to generate SEC Q&A markdown.")
            return out

        out["status"] = "success"
        out["questions"] = questions
        out["text"] = qna_markdown
        return out
    except Exception as exc:
        errors.append(f"Unhandled SEC Q&A builder error: {exc}")
        errors.append(traceback.format_exc(limit=3))
        return out


def build_sec_short_analysis_text(
    ticker: str,
    info_dict: Dict[str, Any],
    files_dict: Dict[str, Any],
    financial_dict: Dict[str, Any],
) -> Dict[str, object]:
    """
    Build SEC-short analysis text from in-memory dicts.

    Returns:
      {
        "status": "success|failed",
        "ticker": "...",
        "text": "...",
        "errors": []
      }
    """
    ticker_u = (ticker or "").strip().upper()
    errors: List[str] = []
    out: Dict[str, object] = {
        "status": "failed",
        "ticker": ticker_u,
        "text": "",
        "errors": errors,
    }

    if not is_valid_ticker(ticker_u):
        errors.append("Invalid ticker format. Expected [A-Z0-9.-]{1,10}.")
        return out

    try:
        _ensure_deepseek_api_key()
        text, gen_errors = _generate_sec_analysis_text(
            ticker=ticker_u,
            info_dict=info_dict or {},
            files_dict=files_dict or {},
            financial_dict=financial_dict or {},
            short_mode=True,
        )
        errors.extend(gen_errors)
        if text:
            out["status"] = "success"
            out["text"] = text
        return out
    except Exception as exc:
        errors.append(f"Unhandled SEC short builder error: {exc}")
        errors.append(traceback.format_exc(limit=3))
        return out


def _run_sec_analysis(
    ticker: str,
    output_dir: str,
    *,
    short_mode: bool,
) -> Dict[str, object]:
    ticker_u = (ticker or "").strip().upper()
    errors: List[str] = []
    result: Dict[str, object] = {
        "status": "failed",
        "ticker": ticker_u,
        "analysis_txt": "",
        "pdf_path": "",
        "chart_path": "",
        "current_revenue": None,
        "target_revenue": None,
        "current_earnings": None,
        "target_earnings": None,
        "errors": errors,
    }

    if not is_valid_ticker(ticker_u):
        errors.append("Invalid ticker format. Expected [A-Z0-9.-]{1,10}.")
        return result

    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    mode_slug = "sec_short" if short_mode else "sec_full"
    analysis_target = out_dir / f"{ticker_u}_{mode_slug}_analysis.txt"
    pdf_target = out_dir / f"{ticker_u}_{mode_slug}_analysis.pdf"
    html_target = out_dir / f"{ticker_u}_{mode_slug}_analysis.html"

    try:
        _ensure_deepseek_api_key()
        from . import legacy_port as legacy
        from .text_to_pdf_check import convert_text_to_pdf

        info_dict, files_dict, financial_dict, _ = legacy.get_dicts(ticker_u)
        generated_text, gen_errors = _generate_sec_analysis_text(
            ticker=ticker_u,
            info_dict=info_dict or {},
            files_dict=files_dict or {},
            financial_dict=financial_dict or {},
            short_mode=short_mode,
        )
        errors.extend(gen_errors)
        if not generated_text:
            return result

        header = (
            f"# {ticker_u} - {'SEC Short' if short_mode else 'SEC Full'} Analysis\n\n"
            "This report is based strictly on SEC filing text + info_dict['info'] + financial_dict['All Reports'].\n\n"
            "\n\n"
        )
        analysis_target.write_text(header + generated_text + "\n", encoding="utf-8")
        result["analysis_txt"] = str(analysis_target)

        try:
            convert_text_to_pdf(analysis_target, pdf_target, html_target)
            if pdf_target.exists():
                result["pdf_path"] = str(pdf_target)
        except Exception as pdf_exc:
            errors.append(f"PDF generation failed: {pdf_exc}")

        has_txt = bool(result.get("analysis_txt"))
        has_pdf = bool(result.get("pdf_path"))
        if has_txt and has_pdf:
            result["status"] = "success"
        elif has_txt:
            result["status"] = "partial_success"
        else:
            result["status"] = "failed"
        return result

    except Exception as exc:
        errors.append(f"Unhandled service error: {exc}")
        errors.append(traceback.format_exc(limit=3))
        result["status"] = "failed"
        return result


def run_sec_analysis_full(ticker: str, output_dir: str) -> Dict[str, object]:
    return _run_sec_analysis(ticker, output_dir, short_mode=False)


def run_sec_analysis_short(ticker: str, output_dir: str) -> Dict[str, object]:
    return _run_sec_analysis(ticker, output_dir, short_mode=True)


def run_sec_analysis(ticker: str, output_dir: str) -> Dict[str, object]:
    """Backward-compatible SEC entrypoint; defaults to SEC Full."""
    return run_sec_analysis_full(ticker, output_dir)


def run_lite_analysis(ticker: str, output_dir: str) -> Dict[str, object]:
    """
    Run lite analysis and return a stable result payload without raising to caller.

    Returns:
        {
          "status": "success | failed | partial_success",
          "ticker": "<TICKER>",
          "analysis_txt": "<path or empty>",
          "pdf_path": "<path or empty>",
          "chart_path": "<path or empty>",
          "errors": ["..."]
        }
    """
    ticker_u = (ticker or "").strip().upper()
    errors: List[str] = []
    result: Dict[str, object] = {
        "status": "failed",
        "ticker": ticker_u,
        "analysis_txt": "",
        "pdf_path": "",
        "chart_path": "",
        "sec_fallback_used": False,
        "sec_fallback_message": "",
        "errors": errors,
    }

    if not is_valid_ticker(ticker_u):
        errors.append("Invalid ticker format. Expected [A-Z0-9.-]{1,10}.")
        return result

    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        _ensure_deepseek_api_key()
        from .lite_test import run_lite_test

        # Isolated CWD prevents collisions on analysis.txt and temporary PDF/HTML names.
        work_dir = out_dir / "_workspace"
        work_dir.mkdir(parents=True, exist_ok=True)
        prev_cwd = Path.cwd()
        try:
            os.chdir(work_dir)
            lite_out = run_lite_test(
                ticker_u,
                text_agents=3,
                valuation_iterations=1,
                llm_workers=4,
                output_root=str(out_dir),
                show_plots=False,
                save_pdf=True,
            )
        finally:
            os.chdir(prev_cwd)

        # Normalize artifacts to output_dir root as a stable API contract.
        analysis_target = out_dir / f"{ticker_u}_lite_analysis.txt"
        pdf_target = out_dir / f"{ticker_u}_lite_analysis.pdf"
        chart_target = out_dir / f"{ticker_u}_lite_prices_valuation.png"

        analysis_src = Path(str(lite_out.get("analysis_txt", "")))
        pdf_src = Path(str(lite_out.get("analysis_pdf", "")))
        chart_src = Path(str(lite_out.get("lite_prices_plot", "")))

        copied_analysis = _copy_artifact(analysis_src, analysis_target)
        copied_pdf = _copy_artifact(pdf_src, pdf_target)
        copied_chart = _copy_artifact(chart_src, chart_target)

        if copied_analysis:
            result["analysis_txt"] = str(analysis_target)
        else:
            errors.append("Analysis TXT was not generated.")

        if copied_pdf:
            result["pdf_path"] = str(pdf_target)

        if copied_chart:
            result["chart_path"] = str(chart_target)
        else:
            errors.append("Valuation chart was not generated.")

        generated_count = int(copied_analysis) + int(copied_pdf) + int(copied_chart)
        if generated_count == 3:
            result["status"] = "success"
        elif generated_count > 0:
            result["status"] = "partial_success"
        else:
            result["status"] = "failed"

        return result

    except Exception as exc:
        errors.append(f"Unhandled service error: {exc}")
        errors.append(traceback.format_exc(limit=3))
        result["status"] = "failed"
        return result


def run_full_analysis(ticker: str, output_dir: str, run_source: str = "site") -> Dict[str, object]:
    """
    Run full analysis pipeline and return a stable result payload without raising.

    Returns the same contract as run_lite_analysis().
    """
    ticker_u = (ticker or "").strip().upper()
    errors: List[str] = []
    result: Dict[str, object] = {
        "status": "failed",
        "ticker": ticker_u,
        "analysis_txt": "",
        "pdf_path": "",
        "chart_path": "",
        "prices_explain_txt": "",
        "prices_explain_pdf": "",
        "dashboard_json": "",
        "f_score_text": "",
        "errors": errors,
    }

    if not is_valid_ticker(ticker_u):
        errors.append("Invalid ticker format. Expected [A-Z0-9.-]{1,10}.")
        return result

    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        _ensure_deepseek_api_key()
        from .runner import run_ticker_valuation

        # Isolated CWD prevents collisions on analysis.txt and temporary files.
        work_dir = out_dir / "_workspace"
        work_dir.mkdir(parents=True, exist_ok=True)
        prev_cwd = Path.cwd()
        try:
            os.chdir(work_dir)
            full_out = run_ticker_valuation(
                ticker_u,
                output_root=str(out_dir),
                save_pdf=True,
                show_plots=False,
                progress_file=str(out_dir / "_progress.log"),
                run_source=run_source,
            )
        finally:
            os.chdir(prev_cwd)

        runner_notes = full_out.get("notes", [])
        if isinstance(runner_notes, list):
            errors.extend(str(x) for x in runner_notes if str(x).strip())
        elif runner_notes:
            errors.append(str(runner_notes))

        analysis_target = out_dir / f"{ticker_u}_analysis.txt"
        pdf_target = out_dir / f"{ticker_u}_analysis.pdf"
        chart_target = out_dir / f"{ticker_u}_prices_valuation.png"
        prices_explain_txt_target = out_dir / f"{ticker_u}_prices_explain.txt"
        prices_explain_pdf_target = out_dir / f"{ticker_u}_prices_explain.pdf"
        dashboard_json_target = out_dir / f"{ticker_u}_dashboard.json"

        analysis_src = Path(str(full_out.get("analysis_txt", "")))
        pdf_src = Path(str(full_out.get("analysis_pdf", "")))
        chart_src = Path(str(full_out.get("prices_plot", "")))
        prices_explain_txt_src = Path(str(full_out.get("prices_explain_txt", "")))
        prices_explain_pdf_src = Path(str(full_out.get("prices_explain_pdf", "")))
        dashboard_json_src = Path(str(full_out.get("dashboard_json", "")))

        copied_analysis = _copy_artifact(analysis_src, analysis_target)
        copied_pdf = _copy_artifact(pdf_src, pdf_target)
        copied_chart = _copy_artifact(chart_src, chart_target)
        copied_prices_explain_txt = _copy_artifact(prices_explain_txt_src, prices_explain_txt_target)
        copied_prices_explain_pdf = _copy_artifact(prices_explain_pdf_src, prices_explain_pdf_target)
        copied_dashboard_json = _copy_artifact(dashboard_json_src, dashboard_json_target)

        if copied_analysis:
            result["analysis_txt"] = str(analysis_target)
        else:
            errors.append("Analysis TXT was not generated.")

        if copied_pdf:
            result["pdf_path"] = str(pdf_target)

        if copied_chart:
            result["chart_path"] = str(chart_target)
        else:
            errors.append("Valuation chart was not generated.")

        if copied_prices_explain_txt:
            result["prices_explain_txt"] = str(prices_explain_txt_target)
        else:
            errors.append("Prices explain TXT was not generated.")

        if copied_prices_explain_pdf:
            result["prices_explain_pdf"] = str(prices_explain_pdf_target)
        else:
            errors.append("Prices explain PDF was not generated.")

        if copied_dashboard_json:
            result["dashboard_json"] = str(dashboard_json_target)
        else:
            errors.append("Dashboard JSON was not generated.")

        result["current_revenue"] = full_out.get("current_revenue")
        result["target_revenue"] = full_out.get("target_revenue")
        result["current_earnings"] = full_out.get("current_earnings")
        result["target_earnings"] = full_out.get("target_earnings")
        result["f_score_text"] = str(full_out.get("f_score_text", "") or "")
        result["sec_fallback_used"] = bool(full_out.get("sec_fallback_used", False))
        result["sec_fallback_message"] = str(full_out.get("sec_fallback_message", "") or "")

        generated_count = (
            int(copied_analysis)
            + int(copied_chart)
            + int(copied_prices_explain_txt)
            + int(copied_prices_explain_pdf)
            + int(copied_dashboard_json)
        )
        if generated_count == 5:
            result["status"] = "success"
        elif generated_count > 0:
            result["status"] = "partial_success"
        else:
            result["status"] = "failed"

        return result

    except Exception as exc:
        errors.append(f"Unhandled service error: {exc}")
        errors.append(traceback.format_exc(limit=3))
        result["status"] = "failed"
        return result
