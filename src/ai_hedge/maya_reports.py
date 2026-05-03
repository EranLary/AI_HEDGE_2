from __future__ import annotations

import io
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import html2text
import requests
import yfinance as yf

try:
    from pypdf import PdfReader  # type: ignore
except Exception:  # pragma: no cover - optional at runtime
    PdfReader = None


MAYA_BASE_URL = "https://maya.tase.co.il"
MAYA_FILES_BASE_URL = "https://mayafiles.tase.co.il"
MAYA_FINANCE_REPORTS_ENDPOINT = f"{MAYA_BASE_URL}/api/v1/reports/finance"
MAYA_REPORT_SEARCH_ENDPOINT = f"{MAYA_BASE_URL}/api/v1/reports/search"
MAYA_REPORT_DETAIL_ENDPOINT = f"{MAYA_BASE_URL}/api/v1/reports/{{report_id}}"
MAYA_COMPANIES_FEED_ENDPOINT = f"{MAYA_BASE_URL}/api/v1/reports/companies"
MAYA_DEFAULT_TIMEOUT = 45

MAYA_PERIOD_Q1 = 1
MAYA_PERIOD_Q2 = 2
MAYA_PERIOD_Q3 = 3
MAYA_PERIOD_ANNUAL = 4
MAYA_PERIOD_ALL = 5

_NON_ALNUM = re.compile(r"[^A-Z0-9]+")
_ANNUAL_PERIOD_RE = re.compile(r"(ANNUAL|שנתי)", re.IGNORECASE)
_QUARTER_PERIOD_RE = re.compile(r"(Q[1-4]|QUARTER|רבעון)", re.IGNORECASE)
_ANNUAL_TITLE_RE = re.compile(r"(דוח\s+תקופתי\s+ושנתי|periodic\s+report|annual\s+report|form\s+20-f)", re.IGNORECASE)
_QUARTER_TITLE_RE = re.compile(
    r"(דוח\s+רבעון|תוצאות\s+רבעון|interim\s+report|report\s+for\s+q[1-4]|financial\s+statements\s+q[1-4]|q[1-4].*(financial|quarter)|quarter.*(ended|results))",
    re.IGNORECASE,
)
_TITLE_EXCLUDE_RE = re.compile(
    r"(מצגת|presentation|investor presentation|מועד פרסום|שיחת ועידה|תפרסם|זימון אסיפה|זימון)",
    re.IGNORECASE,
)
_TA_TICKER_RE = re.compile(r"^[A-Z0-9\.\-]+\.TA$")

_COMPANIES_FEED_PAGE_SIZE = 30
_COMPANIES_FEED_MAX_PAGES = 5

_ANNUAL_FEED_TERMS = (
    "דוח תקופתי ושנתי",
    "דוחות כספיים",
    "periodic report",
    "annual report",
)

_QUARTERLY_FEED_TERMS = (
    "דוח רבעון",
    "דוחות כספיים",
    "interim report",
    "quarter",
    "q1",
    "q2",
    "q3",
)

_NOISY_NAME_TOKENS = {
    "LTD",
    "LIMITED",
    "INC",
    "INCORPORATED",
    "GROUP",
    "CORP",
    "CORPORATION",
    "COMPANY",
    "HOLDINGS",
    "HOLDING",
    "FINANCIAL",
    "FINANCE",
    "THE",
}


def _base_headers(*, lang: str, referer: str) -> Dict[str, str]:
    language = "he-IL,he;q=0.9" if lang.lower() == "he" else "en-US,en;q=0.9"
    return {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Accept-Language": language,
        "Referer": referer,
    }


def _normalize_ticker(ticker: str) -> str:
    return str(ticker or "").strip().upper()


def _is_ta_ticker(ticker: str) -> bool:
    return bool(_TA_TICKER_RE.fullmatch(_normalize_ticker(ticker)))


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _override_config_path() -> Path:
    env_path = str(os.getenv("MAYA_COMPANY_OVERRIDES_PATH", "")).strip()
    if env_path:
        return Path(env_path).expanduser().resolve()
    return _repo_root() / "config" / "maya_company_overrides.json"


def _load_company_overrides() -> Dict[str, int]:
    path = _override_config_path()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, int] = {}
    for k, v in raw.items():
        key = _normalize_ticker(str(k))
        try:
            val = int(v)
        except Exception:
            continue
        if key and val > 0:
            out[key] = val
    return out


def _safe_request_json(
    session: requests.Session,
    *,
    method: str,
    url: str,
    headers: Dict[str, str],
    payload: Optional[Dict[str, Any]] = None,
) -> Optional[Any]:
    req_headers = dict(headers or {})
    if method.upper() != "POST":
        req_headers.pop("Content-Type", None)
    try:
        if method.upper() == "POST":
            resp = session.post(url, headers=req_headers, json=payload or {}, timeout=MAYA_DEFAULT_TIMEOUT)
        else:
            resp = session.get(url, headers=req_headers, timeout=MAYA_DEFAULT_TIMEOUT)
    except Exception:
        return None
    if resp.status_code != 200:
        return None
    try:
        return resp.json()
    except Exception:
        return None


def _safe_request_text(session: requests.Session, *, url: str) -> str:
    try:
        resp = session.get(url, timeout=MAYA_DEFAULT_TIMEOUT)
    except Exception:
        return ""
    if resp.status_code != 200:
        return ""
    return resp.text or ""


def _safe_request_bytes(session: requests.Session, *, url: str) -> bytes:
    try:
        resp = session.get(url, timeout=MAYA_DEFAULT_TIMEOUT)
    except Exception:
        return b""
    if resp.status_code != 200:
        return b""
    return resp.content or b""


def _normalize_name_tokens(value: str) -> List[str]:
    txt = _normalize_ticker(value)
    if not txt:
        return []
    parts = [p for p in _NON_ALNUM.split(txt) if p]
    out: List[str] = []
    for p in parts:
        if p in _NOISY_NAME_TOKENS:
            continue
        if len(p) <= 2:
            continue
        out.append(p)
    return out


def _collect_ticker_terms(ticker: str) -> List[str]:
    base = _normalize_ticker(ticker).replace(".TA", "")
    terms: List[str] = [base]
    try:
        info = yf.Ticker(_normalize_ticker(ticker)).info
    except Exception:
        info = {}
    if isinstance(info, dict):
        for key in ("longName", "shortName", "prevName"):
            val = str(info.get(key, "") or "").strip()
            if val:
                terms.append(val)
    uniq: List[str] = []
    seen = set()
    for term in terms:
        k = term.strip().upper()
        if not k or k in seen:
            continue
        seen.add(k)
        uniq.append(term.strip())
    return uniq


def _iter_companies_from_search_rows(rows: Iterable[Dict[str, Any]]) -> Iterable[Dict[str, Any]]:
    for row in rows:
        if not isinstance(row, dict):
            continue
        companies = row.get("companies", [])
        if not isinstance(companies, list):
            continue
        for comp in companies:
            if isinstance(comp, dict):
                yield comp


def _score_company_candidate(name: str, search_term: str, ticker_base: str) -> int:
    score = 0
    name_u = _normalize_ticker(name)
    term_u = _normalize_ticker(search_term)
    if not name_u:
        return score
    if ticker_base and ticker_base in name_u:
        score += 6
    tokens = _normalize_name_tokens(search_term)
    for tok in tokens:
        if tok in name_u:
            score += 4
    if term_u and term_u == name_u:
        score += 8
    if term_u and term_u in name_u:
        score += 3
    return score


def _resolve_company_id_dynamic(ticker: str, session: requests.Session) -> Optional[int]:
    ticker_u = _normalize_ticker(ticker)
    ticker_base = ticker_u.replace(".TA", "")
    terms = _collect_ticker_terms(ticker_u)
    if not terms:
        return None

    weighted_terms: List[Tuple[str, int]] = []
    for term in terms:
        term_clean = str(term or "").strip()
        if not term_clean:
            continue
        if term_clean.upper() == ticker_base:
            weighted_terms.append((term_clean, 2))
        else:
            weighted_terms.append((term_clean, 5))

    candidate_scores: Dict[int, int] = {}
    candidate_names: Dict[int, str] = {}
    headers = _base_headers(lang="en", referer=f"{MAYA_BASE_URL}/en/reports/search")

    for term, term_weight in weighted_terms:
        payload = {"pageSize": 50, "pageNumber": 1, "freeText": term}
        rows = _safe_request_json(
            session,
            method="POST",
            url=MAYA_REPORT_SEARCH_ENDPOINT,
            headers=headers,
            payload=payload,
        )
        if not isinstance(rows, list):
            continue
        for comp in _iter_companies_from_search_rows(rows):
            try:
                company_id = int(comp.get("companyId"))
            except Exception:
                continue
            if company_id <= 0:
                continue
            company_name = str(comp.get("name", "") or "")
            score = term_weight + _score_company_candidate(company_name, term, ticker_base) + 1
            candidate_scores[company_id] = candidate_scores.get(company_id, 0) + score
            if company_name:
                candidate_names[company_id] = company_name

    if not candidate_scores:
        return None

    name_tokens = set(_normalize_name_tokens(" ".join(terms)))

    def _tie_break(cid: int) -> Tuple[int, int]:
        name_u = _normalize_ticker(candidate_names.get(cid, ""))
        token_hits = sum(1 for tok in name_tokens if tok in name_u)
        return candidate_scores[cid], token_hits

    winner = max(candidate_scores.keys(), key=_tie_break)
    return winner if winner > 0 else None


def _resolve_company_id(ticker: str, session: requests.Session) -> Optional[int]:
    overrides = _load_company_overrides()
    ticker_u = _normalize_ticker(ticker)
    if ticker_u in overrides:
        return overrides[ticker_u]
    return _resolve_company_id_dynamic(ticker_u, session)


def _safe_dt(value: Any) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        return datetime.min
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return datetime.min


def _dedupe_rows_by_id(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen_ids = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        rid = row.get("id")
        if rid in seen_ids:
            continue
        seen_ids.add(rid)
        out.append(row)
    return out


def _fetch_finance_rows(
    session: requests.Session,
    *,
    company_id: int,
    period: int,
    lang: str,
    page_size: int = 20,
) -> List[Dict[str, Any]]:
    payload = {
        "pageSize": page_size,
        "pageNumber": 1,
        "companyId": int(company_id),
        "period": int(period),
    }
    headers = _base_headers(lang=lang, referer=f"{MAYA_BASE_URL}/{lang}/reports/financial-report")
    rows = _safe_request_json(
        session,
        method="POST",
        url=MAYA_FINANCE_REPORTS_ENDPOINT,
        headers=headers,
        payload=payload,
    )
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict)]


def _fetch_companies_feed_rows(
    session: requests.Session,
    *,
    company_id: int,
    lang: str,
    free_text_terms: Iterable[str],
    max_pages: int = _COMPANIES_FEED_MAX_PAGES,
) -> List[Dict[str, Any]]:
    headers = _base_headers(lang=lang, referer=f"{MAYA_BASE_URL}/{lang}/reports/financial-report")
    rows_accum: List[Dict[str, Any]] = []
    terms: List[str] = []
    for term in free_text_terms:
        t = str(term or "").strip()
        if t:
            terms.append(t)
    if not terms:
        terms = [""]

    for term in terms:
        previous_signature: Optional[Tuple[Any, ...]] = None
        for page in range(1, max_pages + 1):
            payload: Dict[str, Any] = {
                "pageSize": _COMPANIES_FEED_PAGE_SIZE,
                "pageNumber": page,
                "companyId": int(company_id),
            }
            if term:
                payload["freeText"] = term

            rows = _safe_request_json(
                session,
                method="POST",
                url=MAYA_COMPANIES_FEED_ENDPOINT,
                headers=headers,
                payload=payload,
            )
            if not isinstance(rows, list) or not rows:
                break

            valid_rows = [r for r in rows if isinstance(r, dict)]
            if not valid_rows:
                break

            signature = tuple(r.get("id") for r in valid_rows[:6])
            if previous_signature is not None and signature == previous_signature:
                break
            previous_signature = signature
            rows_accum.extend(valid_rows)

    return _dedupe_rows_by_id(rows_accum)


def _pick_latest(rows: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    rows_list = [r for r in rows if isinstance(r, dict)]
    if not rows_list:
        return None
    rows_list.sort(key=lambda r: _safe_dt(r.get("publishDate")), reverse=True)
    return rows_list[0]


def _matches_expected_title(title: str, *, report_kind: str) -> bool:
    txt = str(title or "").strip()
    if not txt:
        return False
    if _TITLE_EXCLUDE_RE.search(txt):
        return False
    if report_kind == "annual":
        return bool(_ANNUAL_TITLE_RE.search(txt))
    if report_kind == "quarterly":
        return bool(_QUARTER_TITLE_RE.search(txt))
    return False


def _is_quarter_row(row: Dict[str, Any]) -> bool:
    period = str(row.get("period", "") or "")
    return bool(_QUARTER_PERIOD_RE.search(period))


def _pick_latest_quarter(session: requests.Session, company_id: int, lang: str) -> Optional[Dict[str, Any]]:
    all_rows = _fetch_finance_rows(session, company_id=company_id, period=MAYA_PERIOD_ALL, lang=lang, page_size=50)
    quarter_rows = [r for r in all_rows if _is_quarter_row(r)]
    picked = _pick_latest(quarter_rows)
    if picked is not None:
        return picked

    fallback_rows: List[Dict[str, Any]] = []
    for period in (MAYA_PERIOD_Q1, MAYA_PERIOD_Q2, MAYA_PERIOD_Q3):
        rows = _fetch_finance_rows(session, company_id=company_id, period=period, lang=lang, page_size=20)
        if rows:
            fallback_rows.extend(rows)
    return _pick_latest(fallback_rows)


def _pick_latest_annual(session: requests.Session, company_id: int, lang: str) -> Optional[Dict[str, Any]]:
    rows = _fetch_finance_rows(session, company_id=company_id, period=MAYA_PERIOD_ANNUAL, lang=lang, page_size=50)
    annual_rows = [r for r in rows if _ANNUAL_PERIOD_RE.search(str(r.get("period", "") or ""))]
    if not annual_rows:
        annual_rows = rows
    return _pick_latest(annual_rows)


def _report_detail(session: requests.Session, report_id: int, lang: str) -> Optional[Dict[str, Any]]:
    headers = _base_headers(lang=lang, referer=f"{MAYA_BASE_URL}/{lang}/reports/financial-report")
    url = MAYA_REPORT_DETAIL_ENDPOINT.format(report_id=int(report_id))
    data = _safe_request_json(session, method="GET", url=url, headers=headers)
    return data if isinstance(data, dict) else None


def _pick_row_by_title(
    session: requests.Session,
    *,
    rows: Iterable[Dict[str, Any]],
    report_kind: str,
    lang: str,
) -> Optional[Dict[str, Any]]:
    rows_sorted = sorted((r for r in rows if isinstance(r, dict)), key=lambda r: _safe_dt(r.get("publishDate")), reverse=True)
    for row in rows_sorted:
        row_title = str(row.get("title", "") or "")
        if _matches_expected_title(row_title, report_kind=report_kind):
            return row

        rid = row.get("id")
        try:
            rid_int = int(rid)
        except Exception:
            continue
        detail = _report_detail(session, rid_int, lang=lang)
        if not detail:
            continue
        title = str(detail.get("title", "") or "")
        if _matches_expected_title(title, report_kind=report_kind):
            return row
    return None


def _build_attachment_url(relative_url: str) -> str:
    rel = str(relative_url or "").strip().lstrip("/")
    return f"{MAYA_FILES_BASE_URL}/{rel}" if rel else ""


def _extract_text_from_html(raw_html: str) -> str:
    if not raw_html.strip():
        return ""
    converter = html2text.HTML2Text()
    converter.ignore_links = True
    converter.ignore_images = True
    converter.body_width = 0
    text = converter.handle(raw_html)
    return str(text or "").strip()


def _extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    if not pdf_bytes or PdfReader is None:
        return ""
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception:
        return ""
    parts: List[str] = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(p.strip() for p in parts if p and p.strip()).strip()


def _attachment_candidates(detail: Dict[str, Any]) -> List[Dict[str, Any]]:
    attachments = detail.get("attachments", [])
    if not isinstance(attachments, list):
        return []

    def _priority(att: Dict[str, Any]) -> Tuple[int, int]:
        file_type = str(att.get("fileType", "") or "").lower()
        translated = bool(att.get("translated", False))
        order = 100
        if file_type.startswith("htm"):
            order = 1
        elif file_type.startswith("txt"):
            order = 2
        elif file_type.startswith("pdf"):
            order = 3
        return (order, 1 if translated else 0)

    rows = [a for a in attachments if isinstance(a, dict) and str(a.get("url", "")).strip()]
    rows.sort(key=_priority)
    return rows


def _download_report_text(session: requests.Session, detail: Dict[str, Any]) -> Tuple[str, str]:
    for att in _attachment_candidates(detail):
        rel_url = str(att.get("url", "") or "")
        url = _build_attachment_url(rel_url)
        file_type = str(att.get("fileType", "") or "").lower()
        if not url:
            continue

        if file_type.startswith("htm") or file_type.startswith("txt"):
            html_or_text = _safe_request_text(session, url=url)
            if not html_or_text:
                continue
            if file_type.startswith("txt"):
                text = html_or_text.strip()
            else:
                text = _extract_text_from_html(html_or_text)
            if text:
                return text, url

        if file_type.startswith("pdf"):
            payload = _safe_request_bytes(session, url=url)
            text = _extract_text_from_pdf_bytes(payload)
            if text:
                return text, url
    return "", ""


def _build_entry(label: str, *, detail: Dict[str, Any], text: str, source_url: str) -> Dict[str, Any]:
    publish_date = str(detail.get("publishDate", "") or "")
    title = str(detail.get("title", "") or "")
    if title and title not in text[:2000]:
        text = f"# {title}\n\n{text}".strip()
    return {
        "url": source_url or None,
        "text": text or None,
        "tables": [],
        "date": publish_date or None,
        "title": title or None,
        "source": "MAYA",
        "label": label,
    }


def fetch_latest_maya_reports(ticker: str) -> Dict[str, Dict[str, Any]]:
    """
    Fetch latest annual + quarterly MAYA reports for `.TA` tickers.

    Returns SEC-compatible `files_dict` payload:
      { "<label>": { "url": ..., "text": ..., "tables": [], "date": ... } }
    """
    ticker_u = _normalize_ticker(ticker)
    if not _is_ta_ticker(ticker_u):
        return {}

    session = requests.Session()
    out: Dict[str, Dict[str, Any]] = {}

    company_id = _resolve_company_id(ticker_u, session)
    if not company_id:
        return {}

    annual_primary = _pick_latest_annual(session, company_id=company_id, lang="he")
    annual_rows = _fetch_finance_rows(
        session,
        company_id=company_id,
        period=MAYA_PERIOD_ANNUAL,
        lang="he",
        page_size=50,
    )
    annual_row = _pick_row_by_title(
        session,
        rows=annual_rows,
        report_kind="annual",
        lang="he",
    ) or annual_primary
    if not annual_row:
        annual_feed_rows = _fetch_companies_feed_rows(
            session,
            company_id=company_id,
            lang="he",
            free_text_terms=_ANNUAL_FEED_TERMS,
        )
        annual_row = _pick_row_by_title(
            session,
            rows=annual_feed_rows,
            report_kind="annual",
            lang="he",
        )

    quarter_primary = _pick_latest_quarter(session, company_id=company_id, lang="he")
    quarter_rows: List[Dict[str, Any]] = _fetch_finance_rows(
        session,
        company_id=company_id,
        period=MAYA_PERIOD_ALL,
        lang="he",
        page_size=50,
    )
    if not quarter_rows:
        for period in (MAYA_PERIOD_Q1, MAYA_PERIOD_Q2, MAYA_PERIOD_Q3):
            quarter_rows.extend(
                _fetch_finance_rows(
                    session,
                    company_id=company_id,
                    period=period,
                    lang="he",
                    page_size=20,
                )
            )

    quarter_row = _pick_row_by_title(
        session,
        rows=_dedupe_rows_by_id(quarter_rows),
        report_kind="quarterly",
        lang="he",
    ) or quarter_primary
    if not quarter_row:
        quarter_feed_rows = _fetch_companies_feed_rows(
            session,
            company_id=company_id,
            lang="he",
            free_text_terms=_QUARTERLY_FEED_TERMS,
        )
        quarter_row = _pick_row_by_title(
            session,
            rows=quarter_feed_rows,
            report_kind="quarterly",
            lang="he",
        )

    chosen: List[Tuple[str, Optional[Dict[str, Any]]]] = [
        ("MAYA Annual Report", annual_row),
        ("MAYA Quarterly Report", quarter_row),
    ]

    for label, row in chosen:
        if not row:
            continue
        report_id = row.get("id")
        try:
            report_id_int = int(report_id)
        except Exception:
            continue

        detail: Optional[Dict[str, Any]] = None
        text = ""
        source_url = ""
        for lang in ("he", "en"):
            detail = _report_detail(session, report_id_int, lang=lang)
            if not detail:
                continue
            text, source_url = _download_report_text(session, detail)
            if text:
                break

        if not detail or not text:
            continue
        out[label] = _build_entry(label, detail=detail, text=text, source_url=source_url)

    return out
