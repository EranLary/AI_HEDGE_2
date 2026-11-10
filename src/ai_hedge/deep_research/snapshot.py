from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional


TickerFactory = Callable[[str], Any]


def _clean_text(value: Any, *, max_chars: int = 240) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:max_chars]


def _optional_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def normalize_ticker(value: str) -> str:
    ticker = str(value or "").strip().upper()
    if not ticker or len(ticker) > 32:
        raise ValueError("Ticker must contain between 1 and 32 characters")
    if not re.fullmatch(r"[A-Z0-9.^=_-]+", ticker):
        raise ValueError(f"Unsupported ticker format: {value!r}")
    return ticker


@dataclass(frozen=True)
class CompanySnapshot:
    """Small shared fact set frozen before research begins.

    It deliberately excludes any existing target, recommendation, analysis, and
    share-count candidate so the new model remains analytically independent.
    """

    ticker: str
    company_name: str
    exchange: str
    security_type: str
    quote_currency: str
    reporting_currency: str
    current_price: Optional[float]
    as_of_utc: str
    provider: str = "Yahoo Finance identity snapshot"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def prompt_context(self) -> str:
        price = (
            "Unavailable; research and cite it"
            if self.current_price is None
            else f"{self.current_price:.8g}"
        )
        return "\n".join(
            [
                f"Company: {self.company_name}",
                f"Ticker: {self.ticker}",
                f"Exchange: {self.exchange or 'Unknown'}",
                f"Security type: {self.security_type or 'Unknown'}",
                f"Research as-of timestamp (UTC): {self.as_of_utc}",
                f"Frozen reference market price: {price}",
                f"Quote currency: {self.quote_currency or 'Unknown'}",
                f"Reporting currency: {self.reporting_currency or 'Unknown'}",
                "The frozen reference facts are routing aids, not analytical conclusions. "
                "Verify material facts against current primary sources.",
            ]
        )


def _default_ticker_factory(ticker: str) -> Any:
    import yfinance as yf

    return yf.Ticker(ticker)


def freeze_company_snapshot(
    ticker: str,
    *,
    company_name: Optional[str] = None,
    ticker_factory: Optional[TickerFactory] = None,
    now: Optional[datetime] = None,
) -> CompanySnapshot:
    normalized = normalize_ticker(ticker)
    provider_ticker = (ticker_factory or _default_ticker_factory)(normalized)
    try:
        info_raw = provider_ticker.info
    except Exception as exc:
        raise RuntimeError(f"Unable to resolve {normalized} company identity: {exc}") from exc
    info: Mapping[str, Any] = info_raw if isinstance(info_raw, Mapping) else {}

    resolved_name = _clean_text(
        company_name or info.get("longName") or info.get("shortName"), max_chars=300
    )
    if not resolved_name:
        raise RuntimeError(
            f"Yahoo Finance returned no company name for {normalized}; pass --company-name explicitly."
        )

    generated_at = now or datetime.now(timezone.utc)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    generated_at = generated_at.astimezone(timezone.utc)

    current_price = _optional_float(
        info.get("currentPrice")
        or info.get("regularMarketPrice")
        or info.get("navPrice")
    )
    return CompanySnapshot(
        ticker=normalized,
        company_name=resolved_name,
        exchange=_clean_text(info.get("fullExchangeName") or info.get("exchange")),
        security_type=_clean_text(info.get("quoteType")),
        quote_currency=_clean_text(info.get("currency"), max_chars=16).upper(),
        reporting_currency=_clean_text(info.get("financialCurrency"), max_chars=16).upper(),
        current_price=current_price,
        as_of_utc=generated_at.isoformat().replace("+00:00", "Z"),
    )
