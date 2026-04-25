from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


def _read_text_if_exists(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _parse_generated_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _infer_run_id(ticker_dir: Path) -> str | None:
    parent = ticker_dir.parent.name
    if not parent or parent in {"outputs", "_site_runs", ""}:
        return None
    return parent


def _html_to_md(html_path: Path) -> str | None:
    try:
        import html2text
    except ImportError:
        return None
    raw = _read_text_if_exists(html_path)
    if raw is None:
        return None
    converter = html2text.HTML2Text()
    converter.body_width = 0  # don't wrap lines
    converter.ignore_images = True
    converter.ignore_emphasis = False
    return converter.handle(raw).strip() or None


def _pdf_to_text(pdf_path: Path) -> str | None:
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    if not pdf_path.exists():
        return None
    try:
        reader = PdfReader(str(pdf_path))
    except Exception:
        return None
    chunks: list[str] = []
    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        if text:
            chunks.append(text)
    joined = "\n\n".join(chunks).strip()
    return joined or None


def _extract_md_with_fallback(
    ticker_dir: Path, ticker: str, base_name: str
) -> tuple[str | None, str | None]:
    """
    Returns (markdown_text, source) where source is one of {'txt','html','pdf'},
    or (None, None) if all three sources missing/unreadable.
    """
    txt = _read_text_if_exists(ticker_dir / f"{ticker}_{base_name}.txt")
    if txt:
        return txt, "txt"

    md_from_html = _html_to_md(ticker_dir / f"{ticker}_{base_name}.html")
    if md_from_html:
        return md_from_html, "html"

    md_from_pdf = _pdf_to_text(ticker_dir / f"{ticker}_{base_name}.pdf")
    if md_from_pdf:
        return md_from_pdf, "pdf"

    return None, None


def _safe_float(value):
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def _pluck_dashboard_fields(dashboard: dict) -> dict:
    header = dashboard.get("header") or {}
    decision = dashboard.get("decision_card") or {}
    consensus = ((dashboard.get("valuation_hub") or {}).get("consensus")) or {}
    return {
        "company_name": header.get("company_name"),
        "current_price": _safe_float(header.get("current_price")),
        "market_cap": _safe_float(header.get("market_cap")),
        "currency": header.get("display_currency") or header.get("currency"),
        "recommendation": decision.get("action"),
        "mean_target_price": _safe_float(consensus.get("mean_target_price")),
    }


def ticker_dir_to_row(
    ticker_dir: Path,
    *,
    source: str,
    source_root: Path | None = None,
    origin_root: str | None = None,
) -> dict | None:
    """
    Build the 3-bucket row dict for a ticker output dir:
        {"ticker_row": {...}, "report_row": {...}, "artifact_row": {...}}

    Returns None if the dashboard JSON or analysis markdown (after fallback)
    is missing.
    """
    if not ticker_dir.is_dir():
        return None

    dashboard_files = sorted(ticker_dir.glob("*_dashboard.json"))
    if not dashboard_files:
        return None
    dashboard_path = dashboard_files[-1]

    try:
        dashboard = json.loads(dashboard_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    ticker = dashboard.get("ticker") or ticker_dir.name
    if not ticker:
        return None

    analysis_md, analysis_source = _extract_md_with_fallback(
        ticker_dir, ticker, "analysis"
    )
    if analysis_md is None:
        return None

    prices_explain_md, _ = _extract_md_with_fallback(
        ticker_dir, ticker, "prices_explain"
    )

    generated_at = _parse_generated_at(dashboard.get("generated_at"))
    if generated_at is None:
        generated_at = datetime.fromtimestamp(
            dashboard_path.stat().st_mtime, tz=timezone.utc
        )

    if source_root is not None and origin_root is not None:
        try:
            rel = ticker_dir.resolve().relative_to(source_root.resolve())
            origin_path = (
                origin_root.rstrip("/") + "/" + str(rel).replace("\\", "/")
            )
        except ValueError:
            origin_path = str(ticker_dir.resolve())
    else:
        origin_path = str(ticker_dir.resolve())

    plucked = _pluck_dashboard_fields(dashboard)

    ticker_row = {
        "symbol": ticker,
        "company_name": plucked["company_name"],
        "exchange": (dashboard.get("header") or {}).get("exchange"),
        "currency": plucked["currency"],
    }

    report_row = {
        "ticker": ticker,
        "user_id": None,
        "generated_at": generated_at,
        "dashboard_version": dashboard.get("dashboard_version") or "v2",
        **plucked,
        "visibility": "public",
        "source": source,
        "source_run_id": _infer_run_id(ticker_dir),
        "origin_path": origin_path,
    }

    artifact_row = {
        "dashboard": dashboard,
        "analysis_md": analysis_md,
        "prices_explain_md": prices_explain_md,
        "analysis_md_source": analysis_source,
    }

    return {
        "ticker_row": ticker_row,
        "report_row": report_row,
        "artifact_row": artifact_row,
    }


def iter_ticker_dirs(root: Path) -> Iterator[Path]:
    """
    Yield every directory under `root` that contains at least one
    *_dashboard.json file. Walks at any depth.
    """
    if not root.exists():
        return
    seen: set[Path] = set()
    for dashboard in root.rglob("*_dashboard.json"):
        ticker_dir = dashboard.parent
        if ticker_dir in seen:
            continue
        seen.add(ticker_dir)
        yield ticker_dir
