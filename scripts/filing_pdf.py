from __future__ import annotations

import io
import json
import re
import sys
import tempfile
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from ai_hedge import legacy_port as legacy
from ai_hedge.text_to_pdf_check import convert_text_to_pdf


def _read_input() -> Dict[str, Any]:
    raw = ""
    try:
        raw = input()
    except EOFError:
        raw = ""
    if not raw:
        return {}
    data = json.loads(raw)
    return data if isinstance(data, dict) else {}


def _safe_date(value: Any) -> datetime:
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


def _truncate(text: Any, max_chars: int) -> str:
    out = str(text or "")
    if len(out) <= max_chars:
        return out
    return out[:max_chars]


def _filing_kind(label: str, payload: Dict[str, Any]) -> str:
    joined = " ".join(
        [
            str(label or ""),
            str(payload.get("form_type") or ""),
            str(payload.get("title") or ""),
            str(payload.get("name") or ""),
        ]
    ).upper()
    if any(x in joined for x in ("10-K", "20-F", "ANNUAL", "MAYA ANNUAL")):
        return "annual"
    if any(x in joined for x in ("10-Q", "6-K", "QUARTER", "Q1", "Q2", "Q3", "Q4", "MAYA QUARTERLY")):
        return "quarterly"
    return "other"


def _extract_filing_entries(files_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for key, raw in files_dict.items():
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()
        if not text:
            continue
        form_type = str(raw.get("form_type") or key or "").strip()
        source = "MAYA" if "MAYA" in str(key).upper() else "SEC"
        rows.append(
            {
                "kind": _filing_kind(str(key), raw),
                "source": source,
                "form_type": form_type,
                "date": str(raw.get("date") or "").strip(),
                "source_url": str(raw.get("url") or "").strip(),
                "text": _truncate(text, 400000),
            }
        )
    rows.sort(key=lambda x: _safe_date(x.get("date")), reverse=True)
    return rows


def _pick_latest(entries: List[Dict[str, Any]], kind: str) -> Optional[Dict[str, Any]]:
    for row in entries:
        if row.get("kind") == kind:
            return row
    return None


def _clean_filing_text(text: str) -> str:
    cleaned = str(text or "")
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = re.sub(r"https?://\S+", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\b(?:us-gaap|dei|xbrli|link|iso4217|xlink|srt|country|tsla):[A-Za-z0-9_.-]+\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\b[A-Za-z0-9._:/-]{40,}\b", " ", cleaned)

    lines: List[str] = []
    for raw_line in cleaned.split("\n"):
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        if not line:
            continue
        alpha_count = sum(ch.isalpha() for ch in line)
        if alpha_count < 3:
            continue
        lines.append(line)

    deduped: List[str] = []
    prev = ""
    for line in lines:
        if line == prev:
            continue
        deduped.append(line)
        prev = line

    out = "\n\n".join(deduped)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def _build_markdown(ticker: str, kind: str, filing: Dict[str, Any]) -> str:
    title = "Annual Filing" if kind == "annual" else "Quarterly Filing"
    source = str(filing.get("source") or "")
    form_type = str(filing.get("form_type") or "")
    date = str(filing.get("date") or "")
    source_url = str(filing.get("source_url") or "")
    text = _clean_filing_text(str(filing.get("text") or ""))
    if not text:
        text = "Filing text could not be cleaned for display."
    return (
        f"# {ticker} {title}\n\n"
        f"- Source: {source or 'N/A'}\n"
        f"- Form Type: {form_type or 'N/A'}\n"
        f"- Date: {date or 'N/A'}\n\n"
        f"- Source Filing URL: {source_url or 'N/A'}\n\n"
        f"---\n\n"
        f"{text}\n"
    )


def main() -> int:
    req = _read_input()
    ticker = str(req.get("ticker") or "").strip().upper()
    kind = str(req.get("kind") or "").strip().lower()

    if not ticker:
        print(json.dumps({"ok": False, "error": "ticker_required"}))
        return 0
    if kind not in {"annual", "quarterly"}:
        print(json.dumps({"ok": False, "error": "invalid_kind"}))
        return 0

    context_error = ""
    try:
        captured_stdout = io.StringIO()
        with redirect_stdout(captured_stdout):
            _info_dict, files_dict, _financial_dict, _variables_dict = legacy.get_dicts(ticker)
        noisy_logs = captured_stdout.getvalue()
        if noisy_logs.strip():
            print(noisy_logs, file=sys.stderr, end="")
    except Exception as exc:
        files_dict = {}
        context_error = str(exc)

    files_dict = files_dict if isinstance(files_dict, dict) else {}
    entries = _extract_filing_entries(files_dict)
    filing = _pick_latest(entries, kind)

    if not filing:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "filing_not_available",
                    "ticker": ticker,
                    "kind": kind,
                    "context_error": context_error,
                }
            )
        )
        return 0

    temp_dir = Path(tempfile.mkdtemp(prefix=f"filing_pdf_{ticker}_{kind}_"))
    txt_path = temp_dir / f"{ticker}_{kind}_filing.txt"
    pdf_path = temp_dir / f"{ticker}_{kind}_filing.pdf"
    html_path = temp_dir / f"{ticker}_{kind}_filing.html"

    txt_path.write_text(_build_markdown(ticker, kind, filing), encoding="utf-8")
    try:
        convert_text_to_pdf(txt_path, pdf_path, html_path)
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"pdf_generation_failed:{exc}",
                    "ticker": ticker,
                    "kind": kind,
                }
            )
        )
        return 0

    print(
        json.dumps(
            {
                "ok": True,
                "ticker": ticker,
                "kind": kind,
                "file_name": f"{ticker}_{kind}_filing.pdf",
                "pdf_path": str(pdf_path),
                "filing": {
                    "available": True,
                    "source": str(filing.get("source") or ""),
                    "form_type": str(filing.get("form_type") or ""),
                    "date": str(filing.get("date") or ""),
                    "source_url": str(filing.get("source_url") or ""),
                    "text": str(filing.get("text") or ""),
                },
                "context_error": context_error,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
