from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List

from ai_hedge import legacy_port as legacy


def _read_input() -> Dict[str, Any]:
    raw = input()
    data = json.loads(raw) if raw else {}
    return data if isinstance(data, dict) else {}


def _truncate(text: Any, max_chars: int) -> str:
    out = str(text or "")
    if len(out) <= max_chars:
        return out
    return out[:max_chars]


def _as_messages(value: Any) -> List[Dict[str, str]]:
    if not isinstance(value, list):
        return []
    out: List[Dict[str, str]] = []
    for item in value[-20:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = _truncate(item.get("content"), 3500).strip()
        if not content:
            continue
        out.append({"role": role, "content": content})
    return out


def _history_block(messages: List[Dict[str, str]]) -> str:
    if not messages:
        return "No previous conversation."
    lines: List[str] = []
    for row in messages:
        role = "User" if row["role"] == "user" else "Assistant"
        lines.append(f"{role}: {row['content']}")
    return "\n\n".join(lines)


def _context_block(context: Dict[str, Any], key: str, label: str, max_chars: int) -> str:
    value = context.get(key)
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False)
    else:
        text = str(value or "")
    trimmed = _truncate(text, max_chars).strip()
    if not trimmed:
        trimmed = "Not available."
    return f"### {label}\n{trimmed}"


def _build_prompt(payload: Dict[str, Any]) -> str:
    ticker = str(payload.get("ticker") or "").strip().upper()
    persona = str(payload.get("persona") or "").strip() or "Dream Team Valuator"
    user_message = _truncate(payload.get("user_message"), 4000).strip()
    context = payload.get("context_blocks") if isinstance(payload.get("context_blocks"), dict) else {}
    messages = _as_messages(payload.get("messages"))

    today_date = str(context.get("today_date") or datetime.utcnow().date().isoformat())

    sections = [
        _context_block(context, "analysis_text", "Analysis Text", 30000),
        _context_block(context, "all_reports", "Financial Dict All Reports", 30000),
        _context_block(context, "financial_info", "Financial Dict Info", 12000),
        _context_block(context, "currency_statement", "Currency Statement", 3000),
        _context_block(context, "info_financials", "Financial Dict Info Financials", 12000),
        _context_block(context, "rate", "Financial Dict Rate", 3000),
        _context_block(context, "persona_prior_text", "Persona Prior Answer Plain Text", 20000),
    ]

    if context.get("annual_report_text"):
        sections.append(_context_block(context, "annual_report_text", "Optional Annual Filing Context", 30000))
    if context.get("quarterly_report_text"):
        sections.append(_context_block(context, "quarterly_report_text", "Optional Quarterly Filing Context", 30000))

    context_blob = "\n\n".join(sections)
    history_blob = _history_block(messages)

    return f"""You are the digital embodiment of {persona}.
Adopt {persona}'s investment philosophy, risk posture, valuation style, and mental models.
Stay faithful to this persona's way of reasoning, including what to ignore.
try to answer the same way {persona} would. keep his tone, style and depth.


Task:
- Answer the user's question as {persona}.
- Be analytical and specific, using the provided context first.
- Always reply in the same language as the user's latest message (for example: Hebrew -> Hebrew, English -> English).
- Use a balanced default length: not too short and not too long. Aim for clear, useful depth in roughly 1-3 short paragraphs or 4-8 concise bullets, unless the user asks for a different length.
- If something is missing in context, explicitly say what is uncertain.
- Output clean plain-text or markdown only (no JSON).
- Do not provide personal financial advice; frame as research analysis.

Ticker: {ticker}
Today date: {today_date}

Context package:
{context_blob}

Conversation so far:
{history_blob}

User question:
{user_message}
"""


def main() -> int:
    req = _read_input()
    prompt = _build_prompt(req)
    reply = legacy.deepseek_simple_text(
        api_key=legacy.DEEPSEEK_API_KEY,
        prompt=prompt,
        short_answer=False,
        temperature=0.0,
        model="deepseek-chat",
    )
    print(
        json.dumps(
            {
                "ok": True,
                "reply": str(reply or "").strip(),
                "model": "deepseek-chat",
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
