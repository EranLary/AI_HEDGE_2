from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional

from .snapshot import CompanySnapshot


TickerFactory = Callable[[str], Any]


def _clean(value: Any, *, limit: int = 2_000) -> str:
    return " ".join(str(value or "").split())[:limit]


def _positive_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _last_close(
    ticker: Any, *, cutoff: Optional[datetime] = None
) -> tuple[Optional[float], Optional[str]]:
    try:
        history = ticker.history(
            period="1mo" if cutoff else "5d", interval="1d", auto_adjust=False
        )
    except Exception:
        return None, None
    if history is None or getattr(history, "empty", True) or "Close" not in history:
        return None, None
    closes = history["Close"].dropna()
    if cutoff is not None and not closes.empty:
        cutoff_date = cutoff.date()
        closes = closes[
            [
                getattr(index_value, "date", lambda: cutoff_date)() <= cutoff_date
                for index_value in closes.index
            ]
        ]
    if closes.empty:
        return None, None
    value = _positive_float(closes.iloc[-1])
    index_value = closes.index[-1]
    try:
        observed_at = index_value.isoformat()
    except Exception:
        observed_at = str(index_value)
    return value, observed_at


@dataclass(frozen=True)
class ResearchInputPacket:
    version: str
    generated_at_utc: str
    identity: dict[str, Any]
    company_profile: dict[str, Any]
    market_reference: dict[str, Any]
    currency_context: dict[str, Any]
    risk_free_context: dict[str, Any]
    policy: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _default_ticker_factory(symbol: str) -> Any:
    import yfinance as yf

    return yf.Ticker(symbol)


def _fx_context(
    base: str,
    quote: str,
    *,
    ticker_factory: TickerFactory,
    cutoff: datetime,
) -> dict[str, Any]:
    base = str(base or "").upper()
    quote = str(quote or "").upper()
    if not base or not quote:
        return {
            "status": "unavailable",
            "reason": "quote or reporting currency is missing",
        }
    if base == quote:
        return {
            "status": "not_required",
            "base_currency": base,
            "quote_currency": quote,
            "quote_units_per_base_unit": 1.0,
            "source": "currency identity",
        }

    direct_symbol = f"{base}{quote}=X"
    direct_value, observed_at = _last_close(
        ticker_factory(direct_symbol), cutoff=cutoff
    )
    if direct_value:
        return {
            "status": "available",
            "base_currency": base,
            "quote_currency": quote,
            "quote_units_per_base_unit": direct_value,
            "symbol": direct_symbol,
            "observed_at": observed_at,
            "source": "Yahoo Finance FX history",
            "transformation": "direct",
        }

    inverse_symbol = f"{quote}{base}=X"
    inverse_value, observed_at = _last_close(
        ticker_factory(inverse_symbol), cutoff=cutoff
    )
    if inverse_value:
        return {
            "status": "available",
            "base_currency": base,
            "quote_currency": quote,
            "quote_units_per_base_unit": 1.0 / inverse_value,
            "symbol": inverse_symbol,
            "observed_at": observed_at,
            "source": "Yahoo Finance FX history",
            "transformation": "inverse",
            "raw_inverse_rate": inverse_value,
        }
    return {
        "status": "unavailable",
        "base_currency": base,
        "quote_currency": quote,
        "attempted_symbols": [direct_symbol, inverse_symbol],
        "reason": "Yahoo Finance returned no positive recent close",
    }


def build_research_input_packet(
    snapshot: CompanySnapshot,
    *,
    ticker_factory: Optional[TickerFactory] = None,
    now: Optional[datetime] = None,
) -> ResearchInputPacket:
    """Build a small deterministic routing packet, not a shadow financial model.

    Yahoo ``info`` is intentionally limited to identity and descriptive fields.
    Financial statement values, shares, cash and debt still have to come from
    primary filings and survive the evidence/valuation compiler.
    """

    factory = ticker_factory or _default_ticker_factory
    ticker_obj = factory(snapshot.ticker)
    try:
        info_raw = ticker_obj.info
    except Exception:
        info_raw = {}
    info: Mapping[str, Any] = info_raw if isinstance(info_raw, Mapping) else {}
    generated_at = now or datetime.now(timezone.utc)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    generated_at = generated_at.astimezone(timezone.utc)
    cutoff = datetime.fromisoformat(snapshot.as_of_utc.replace("Z", "+00:00"))
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    reporting_currency = snapshot.reporting_currency or snapshot.quote_currency
    fx = _fx_context(
        reporting_currency,
        snapshot.quote_currency,
        ticker_factory=factory,
        cutoff=cutoff,
    )
    treasury_value, treasury_date = _last_close(factory("^TNX"), cutoff=cutoff)
    risk_free = (
        {
            "status": "available",
            "tenor": "10Y US Treasury proxy",
            "annual_rate_decimal": treasury_value / 100.0,
            "raw_index_value": treasury_value,
            "observed_at": treasury_date,
            "symbol": "^TNX",
            "source": "Yahoo Finance market history",
            "usage_note": "Routing prior only; verify the dated rate against an official source before valuation publication.",
        }
        if treasury_value
        else {
            "status": "unavailable",
            "symbol": "^TNX",
            "reason": "Yahoo Finance returned no positive recent close",
        }
    )
    profile = {
        "sector": _clean(info.get("sector"), limit=160),
        "industry": _clean(info.get("industry"), limit=240),
        "country": _clean(info.get("country"), limit=120),
        "website": _clean(info.get("website"), limit=500),
        "employees": int(info["fullTimeEmployees"])
        if isinstance(info.get("fullTimeEmployees"), (int, float))
        and info.get("fullTimeEmployees", 0) > 0
        else None,
        "business_summary": _clean(info.get("longBusinessSummary"), limit=2_000),
        "source": "Yahoo Finance info (descriptive routing fields only)",
    }
    return ResearchInputPacket(
        version="research-input-packet-v2",
        generated_at_utc=generated_at.isoformat().replace("+00:00", "Z"),
        identity=snapshot.to_dict(),
        company_profile=profile,
        market_reference={
            "price": snapshot.current_price,
            "currency": snapshot.quote_currency,
            "as_of_utc": snapshot.as_of_utc,
            "source": snapshot.provider,
        },
        currency_context={
            "reporting_currency": reporting_currency,
            "quote_currency": snapshot.quote_currency,
            "reporting_to_quote_fx": fx,
            "policy": "Never substitute 1.0 when currencies differ and FX is unavailable.",
        },
        risk_free_context=risk_free,
        policy={
            "allowed_yahoo_fields": "identity, descriptive profile, reference price, FX and rate routing priors",
            "forbidden_as_final_evidence": [
                "shares outstanding",
                "cash",
                "debt",
                "statement line items",
                "analyst target price",
            ],
            "primary_filing_required_for_financial_inputs": True,
        },
    )
