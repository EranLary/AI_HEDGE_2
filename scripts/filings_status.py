from __future__ import annotations

import io
import json
import sys
from contextlib import redirect_stdout
from datetime import datetime
from typing import Any, Dict, List, Optional

from ai_hedge import legacy_port as legacy

MAYA_BASE_URL = "https://maya.tase.co.il"
MAYA_FILES_BASE_URL = "https://mayafiles.tase.co.il"


def _read_input() -> Dict[str, Any]:
    raw = ""
    try:
        raw = input()
    except EOFError:
        raw = ""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


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


def _normalize_source_url(raw_url: Any, source: str) -> str:
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
                return f"{MAYA_BASE_URL}{url}"
            return f"{MAYA_FILES_BASE_URL}{url}"
        return f"{MAYA_FILES_BASE_URL}/{url.lstrip('/')}"

    if "." in url and "/" in url:
        return f"https://{url.lstrip('/')}"
    return url


def _filing_kind(label: str, payload: Dict[str, Any]) -> str:
    joined = " ".join(
        [
            str(label or ""),
            str(payload.get("form_type") or ""),
            str(payload.get("title") or ""),
            str(payload.get("name") or ""),
            str(payload.get("label") or ""),
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
        source_raw = str(raw.get("source") or "")
        source = source_raw.strip().upper() or ("MAYA" if "MAYA" in str(key).upper() else "SEC")
        rows.append(
            {
                "kind": _filing_kind(str(key), raw),
                "source": source,
                "form_type": form_type,
                "date": str(raw.get("date") or "").strip(),
                "source_url": _normalize_source_url(
                    raw.get("url") or raw.get("source_url") or raw.get("link") or raw.get("href"),
                    source,
                ),
                "text": _truncate(text, 220000),
            }
        )
    rows.sort(key=lambda x: _safe_date(x.get("date")), reverse=True)
    return rows


def _pick_latest(entries: List[Dict[str, Any]], kind: str) -> Optional[Dict[str, Any]]:
    for row in entries:
        if row.get("kind") == kind:
            return row
    return None


def _empty_filing() -> Dict[str, Any]:
    return {"available": False, "source": "", "form_type": "", "date": "", "source_url": "", "text": ""}


def _to_filing_payload(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not row:
        return _empty_filing()
    return {
        "available": True,
        "source": str(row.get("source") or ""),
        "form_type": str(row.get("form_type") or ""),
        "date": str(row.get("date") or ""),
        "source_url": str(row.get("source_url") or ""),
        "text": str(row.get("text") or ""),
    }


def main() -> int:
    req = _read_input()
    ticker = str(req.get("ticker") or "").strip().upper()

    if not ticker:
        print(json.dumps({"ok": False, "error": "ticker_required"}))
        return 0

    context_error = ""
    try:
        captured_stdout = io.StringIO()
        with redirect_stdout(captured_stdout):
            files_dict = legacy.latest_filing_full_text(ticker)
        noisy_logs = captured_stdout.getvalue()
        if noisy_logs.strip():
            print(noisy_logs, file=sys.stderr, end="")
    except Exception as exc:
        files_dict = {}
        context_error = str(exc)

    files_dict = files_dict if isinstance(files_dict, dict) else {}
    rows = _extract_filing_entries(files_dict)
    annual = _pick_latest(rows, "annual")
    quarterly = _pick_latest(rows, "quarterly")

    print(
        json.dumps(
            {
                "ok": True,
                "ticker": ticker,
                "filings": {
                    "annual": _to_filing_payload(annual),
                    "quarterly": _to_filing_payload(quarterly),
                },
                "context_error": context_error,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

