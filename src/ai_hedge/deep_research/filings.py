from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from .snapshot import CompanySnapshot


FilingFetcher = Callable[[str, Optional[dict[str, Any]]], dict[str, Any]]


def fetch_primary_filing_packet(
    snapshot: CompanySnapshot,
    *,
    output_dir: Path,
    fetcher: Optional[FilingFetcher] = None,
    company_info: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Route to the existing SEC/MAYA fetcher and persist a research manifest.

    This adapter deliberately reuses the platform's filing-selection policy so
    standalone research and the main analysis do not silently choose different
    issuer documents.
    """

    if fetcher is None:
        from ai_hedge.legacy_port import latest_filing_full_text

        fetcher = latest_filing_full_text
    try:
        payload = fetcher(snapshot.ticker, company_info)
    except TypeError:
        payload = fetcher(snapshot.ticker, company_info=company_info)  # type: ignore[call-arg]
    rows = payload if isinstance(payload, Mapping) else {}
    documents_dir = Path(output_dir) / "primary_filings"
    documents_dir.mkdir(parents=True, exist_ok=True)
    packet: list[dict[str, Any]] = []
    for position, (label, raw) in enumerate(rows.items(), start=1):
        row = raw if isinstance(raw, Mapping) else {}
        text = str(row.get("text") or "").strip()
        url = str(row.get("url") or "").strip()
        if not text or not url:
            continue
        suffix = "maya" if snapshot.ticker.endswith(".TA") else "sec"
        filename = f"{position:02d}-{suffix}-{str(label).lower().replace(' ', '-')}.txt"
        path = documents_dir / filename
        path.write_text(text + "\n", encoding="utf-8")
        packet.append(
            {
                "label": str(label),
                "title": str(row.get("title") or f"{snapshot.company_name} {label}"),
                "url": url,
                "published_at": str(row.get("date") or ""),
                "publisher": "MAYA" if snapshot.ticker.endswith(".TA") else "SEC EDGAR",
                "kind": "primary_filing",
                "text": text,
                "local_path": str(path),
                "resolved_company_id": row.get("resolved_company_id"),
            }
        )
    return packet
