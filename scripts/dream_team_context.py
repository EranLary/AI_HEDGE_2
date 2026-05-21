from __future__ import annotations

import json
import io
import sys
from datetime import datetime
from contextlib import redirect_stdout
from typing import Any, Dict, List, Optional, Tuple

from ai_hedge import legacy_port as legacy


def _read_input() -> Dict[str, Any]:
    raw = input()
    data = json.loads(raw) if raw else {}
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


def _to_jsonable(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return str(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for k, v in value.items():
            key = str(k)
            out[key] = _to_jsonable(v, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(v, depth + 1) for v in value[:200]]
    return str(value)


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
    return {"available": False, "source": "", "form_type": "", "date": "", "text": ""}


def _to_filing_payload(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not row:
        return _empty_filing()
    return {
        "available": True,
        "source": str(row.get("source") or ""),
        "form_type": str(row.get("form_type") or ""),
        "date": str(row.get("date") or ""),
        "text": str(row.get("text") or ""),
    }


def main() -> int:
    req = _read_input()
    ticker = str(req.get("ticker") or "").strip().upper()
    include_annual = bool(req.get("include_annual"))
    include_quarterly = bool(req.get("include_quarterly"))

    if not ticker:
        print(json.dumps({"ok": False, "error": "Ticker is required."}))
        return 1

    context_error = ""
    try:
        captured_stdout = io.StringIO()
        with redirect_stdout(captured_stdout):
            info_dict, files_dict, financial_dict, _variables_dict = legacy.get_dicts(ticker)
        noisy_logs = captured_stdout.getvalue()
        if noisy_logs.strip():
            print(noisy_logs, file=sys.stderr, end="")
    except Exception as exc:
        info_dict, files_dict, financial_dict = {}, {}, {}
        context_error = str(exc)

    files_dict = files_dict if isinstance(files_dict, dict) else {}
    financial_dict = financial_dict if isinstance(financial_dict, dict) else {}

    all_reports = str(
        financial_dict.get("all_reports")
        or financial_dict.get("All Reports")
        or financial_dict.get("all reports")
        or ""
    )

    financial_slice = {
        "all_reports": _truncate(all_reports, 200000),
        "info": _to_jsonable(financial_dict.get("info", {})),
        "currency_statement": str(financial_dict.get("currency_statement") or ""),
        "info_financials": _to_jsonable(financial_dict.get("info_financials", {})),
        "rate": financial_dict.get("rate", 0),
        "ticker_info": _to_jsonable((info_dict or {}).get("info", {})),
    }

    rows = _extract_filing_entries(files_dict)
    annual = _pick_latest(rows, "annual")
    quarterly = _pick_latest(rows, "quarterly")

    filings = {
        "annual": _to_filing_payload(annual) if include_annual else _empty_filing(),
        "quarterly": _to_filing_payload(quarterly) if include_quarterly else _empty_filing(),
    }

    print(
        json.dumps(
            {
                "ok": True,
                "ticker": ticker,
                "financial_dict": financial_slice,
                "filings": filings,
                "context_error": context_error,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
