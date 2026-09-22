from __future__ import annotations

import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

import yfinance as yf


BENCHMARK_SYMBOL = "^SP500TR"
PROVIDER_NAME = "yfinance"
MAX_FX_AGE_DAYS = 5


@dataclass(frozen=True)
class FxSpec:
    symbol: str
    operation: str


@dataclass(frozen=True)
class CorporateAction:
    successor_symbol: str
    effective_date: date
    shares_per_predecessor_share: float
    source: str


FX_SPECS: dict[str, FxSpec] = {
    "ILS": FxSpec("ILS=X", "divide"),
    "CAD": FxSpec("CAD=X", "divide"),
    "GBP": FxSpec("GBPUSD=X", "multiply"),
}


def normalize_currency(currency: object) -> str:
    normalized = str(currency or "").strip().upper()
    if normalized == "ILA":
        return "ILS"
    if normalized in {"GBX", "GBP"}:
        return "GBP"
    return normalized


def quote_unit_scale_to_currency(symbol: str, currency: str) -> float:
    normalized_symbol = str(symbol or "").strip().upper()
    normalized_currency = normalize_currency(currency)
    if normalized_currency == "ILS" and normalized_symbol.endswith(".TA"):
        return 0.01  # Yahoo quotes Tel Aviv prices in agorot.
    if normalized_currency == "GBP" and normalized_symbol.endswith(".L"):
        return 0.01  # Yahoo normally quotes London prices in pence.
    return 1.0


def _safe_float(value: object) -> float | None:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def fx_rate_to_usd(currency: str, quote: object | None) -> float | None:
    normalized = normalize_currency(currency)
    if normalized == "USD":
        return 1.0
    spec = FX_SPECS.get(normalized)
    parsed = _safe_float(quote)
    if spec is None or parsed is None:
        return None
    return 1.0 / parsed if spec.operation == "divide" else parsed


def _date_key(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        return None


def _history_to_map(history: Any) -> dict[date, float]:
    if history is None or getattr(history, "empty", True):
        return {}
    try:
        closes = history["Close"]
    except Exception:
        return {}
    output: dict[date, float] = {}
    for idx, value in closes.items():
        key = _date_key(idx)
        parsed = _safe_float(value)
        if key is not None and parsed is not None:
            output[key] = parsed
    return output


def fetch_adjusted_closes(symbol: str, start: date, end: date) -> dict[date, float]:
    ticker = yf.Ticker(symbol)
    history = ticker.history(
        start=start.isoformat(),
        end=(end + timedelta(days=1)).isoformat(),
        interval="1d",
        auto_adjust=True,
        actions=False,
        raise_errors=False,
    )
    return _history_to_map(history)


def _last_quote_on_or_before(
    quotes: dict[date, float],
    target: date,
    *,
    max_age_days: int,
) -> tuple[float, date] | None:
    eligible = [quote_date for quote_date in quotes if quote_date <= target]
    if not eligible:
        return None
    quote_date = max(eligible)
    if (target - quote_date).days > max_age_days:
        return None
    return quotes[quote_date], quote_date


def build_usd_rows(
    symbol: str,
    currency: str,
    local_closes: dict[date, float],
    fx_closes: dict[date, float] | None = None,
    *,
    max_fx_age_days: int = MAX_FX_AGE_DAYS,
) -> list[dict[str, object]]:
    normalized_currency = normalize_currency(currency)
    quote_scale = quote_unit_scale_to_currency(symbol, normalized_currency)
    rows: list[dict[str, object]] = []
    for price_date in sorted(local_closes):
        local_close = local_closes[price_date]
        fx_quote_date: date | None = price_date
        if normalized_currency == "USD":
            fx_to_usd = 1.0
        else:
            matched = _last_quote_on_or_before(
                fx_closes or {},
                price_date,
                max_age_days=max_fx_age_days,
            )
            if matched is None:
                continue
            quote, fx_quote_date = matched
            fx_to_usd = fx_rate_to_usd(normalized_currency, quote)
        if fx_to_usd is None:
            continue
        rows.append(
            {
                "symbol": symbol,
                "date": price_date.isoformat(),
                "adjusted_close_local": local_close,
                "currency": normalized_currency,
                "fx_to_usd": fx_to_usd,
                "adjusted_close_usd": local_close * quote_scale * fx_to_usd,
                "fx_quote_date": fx_quote_date.isoformat() if fx_quote_date else None,
            }
        )
    return rows


def _configure_cache(repo_root: Path) -> None:
    cache_dir = repo_root / ".yfinance_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    if hasattr(yf, "set_tz_cache_location"):
        yf.set_tz_cache_location(str(cache_dir))


def _load_corporate_actions(repo_root: Path) -> dict[str, CorporateAction]:
    config_path = repo_root / "config" / "portfolio_corporate_actions.json"
    if not config_path.exists():
        return {}
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    actions: dict[str, CorporateAction] = {}
    for raw_symbol, raw_action in payload.items():
        symbol = str(raw_symbol or "").strip().upper()
        successor_symbol = str(raw_action.get("successor_symbol") or "").strip().upper()
        effective_date = date.fromisoformat(str(raw_action.get("effective_date") or ""))
        ratio = _safe_float(raw_action.get("shares_per_predecessor_share"))
        if not symbol or not successor_symbol or ratio is None:
            raise ValueError(f"Invalid portfolio corporate action for {raw_symbol!r}")
        actions[symbol] = CorporateAction(
            successor_symbol=successor_symbol,
            effective_date=effective_date,
            shares_per_predecessor_share=ratio,
            source=str(raw_action.get("source") or "").strip(),
        )
    return actions


def fetch_price_bundle(
    instruments: Iterable[dict[str, object]],
    *,
    start: date,
    end: date,
    repo_root: Path,
    workers: int = 8,
    benchmark_symbol: str = BENCHMARK_SYMBOL,
) -> dict[str, object]:
    _configure_cache(repo_root)
    corporate_actions = _load_corporate_actions(repo_root)
    normalized: list[tuple[str, str]] = []
    for instrument in instruments:
        symbol = str(instrument.get("symbol") or "").strip().upper()
        currency = normalize_currency(instrument.get("currency"))
        if symbol and currency:
            normalized.append((symbol, currency))
    normalized_benchmark = str(benchmark_symbol or BENCHMARK_SYMBOL).strip().upper()
    normalized.append((normalized_benchmark, "USD"))
    normalized = list(dict.fromkeys(normalized))

    fx_symbols = {
        FX_SPECS[currency].symbol
        for _, currency in normalized
        if currency != "USD" and currency in FX_SPECS
    }
    requested_actions = {
        symbol: corporate_actions[symbol]
        for symbol, _ in normalized
        if symbol in corporate_actions
    }
    successor_symbols = {action.successor_symbol for action in requested_actions.values()}
    download_symbols = list(dict.fromkeys(
        [symbol for symbol, _ in normalized] + sorted(fx_symbols | successor_symbols)
    ))
    histories: dict[str, dict[date, float]] = {}
    fetch_errors: dict[str, str] = {}
    max_workers = max(1, min(int(workers or 8), 16))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(fetch_adjusted_closes, symbol, start, end): symbol
            for symbol in download_symbols
        }
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                histories[symbol] = future.result()
                if not histories[symbol]:
                    fetch_errors[symbol] = "no_data"
            except Exception as exc:  # noqa: BLE001
                histories[symbol] = {}
                fetch_errors[symbol] = f"{type(exc).__name__}: {exc}"

    assets: dict[str, list[dict[str, object]]] = {}
    errors: list[dict[str, str]] = []
    resolutions: list[dict[str, object]] = []
    for symbol, currency in normalized:
        local_closes = dict(histories.get(symbol, {}))
        action = requested_actions.get(symbol)
        if action is not None:
            resolutions.append(
                {
                    "symbol": symbol,
                    "successor_symbol": action.successor_symbol,
                    "effective_date": action.effective_date.isoformat(),
                    "shares_per_predecessor_share": action.shares_per_predecessor_share,
                    "source": action.source,
                }
            )
            successor_closes = {
                quote_date: quote * action.shares_per_predecessor_share
                for quote_date, quote in histories.get(action.successor_symbol, {}).items()
                if quote_date >= action.effective_date
            }
            local_closes.update(successor_closes)
            if not successor_closes and end >= action.effective_date:
                errors.append(
                    {
                        "symbol": symbol,
                        "error": "corporate_action_successor_no_data",
                    }
                )
            elif not local_closes:
                errors.append(
                    {"symbol": symbol, "error": fetch_errors.get(symbol, "no_data")}
                )
        elif symbol in fetch_errors:
            errors.append({"symbol": symbol, "error": fetch_errors[symbol]})
        spec = FX_SPECS.get(currency)
        fx_closes = histories.get(spec.symbol, {}) if spec else None
        assets[symbol] = build_usd_rows(
            symbol,
            currency,
            local_closes,
            fx_closes,
        )

    for fx_symbol in sorted(fx_symbols):
        if fx_symbol in fetch_errors:
            errors.append({"symbol": fx_symbol, "error": fetch_errors[fx_symbol]})

    return {
        "provider": PROVIDER_NAME,
        "benchmark_symbol": normalized_benchmark,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "assets": assets,
        "errors": errors,
        "corporate_actions": resolutions,
    }
