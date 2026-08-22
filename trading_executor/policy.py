from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from typing import Iterable


RESERVE_FRACTION = Decimal("0.02")
QUANTITY_TOLERANCE = Decimal("0.000001")


@dataclass(frozen=True)
class Instrument:
    symbol: str
    conid: int
    currency: str
    primary_exchange: str
    min_tick: Decimal
    size_increment: Decimal
    supports_fractional: bool
    approved: bool
    exchange: str = "SMART"
    min_size: Decimal = Decimal("1")
    liquid_hours: str = ""
    time_zone: str = ""


@dataclass(frozen=True)
class Target:
    symbol: str
    weight: Decimal


@dataclass(frozen=True)
class Position:
    symbol: str
    quantity: Decimal


@dataclass(frozen=True)
class Quote:
    symbol: str
    bid: Decimal
    ask: Decimal
    age_seconds: float


@dataclass(frozen=True)
class OrderIntent:
    symbol: str
    conid: int
    side: str
    quantity: Decimal
    limit_price: Decimal
    min_tick: Decimal


def investable_budget(budget_usd: Decimal) -> Decimal:
    if budget_usd <= 0:
        raise ValueError("budget must be positive")
    return (budget_usd * (Decimal("1") - RESERVE_FRACTION)).quantize(Decimal("0.01"))


def round_quantity(quantity: Decimal, increment: Decimal, fractional: bool) -> Decimal:
    effective_increment = increment if fractional else max(Decimal("1"), increment)
    if effective_increment <= 0:
        raise ValueError("size increment must be positive")
    return (quantity / effective_increment).to_integral_value(rounding=ROUND_FLOOR) * effective_increment


def marketable_limit(side: str, quote: Quote, min_tick: Decimal, cushion_bps: Decimal = Decimal("10")) -> Decimal:
    if quote.bid <= 0 or quote.ask <= 0 or quote.ask < quote.bid:
        raise ValueError(f"invalid NBBO for {quote.symbol}")
    if quote.age_seconds > 15:
        raise ValueError(f"stale NBBO for {quote.symbol}")
    if min_tick <= 0:
        raise ValueError(f"invalid tick increment for {quote.symbol}")
    multiplier = Decimal("1") + cushion_bps / Decimal("10000") if side == "BUY" else Decimal("1") - cushion_bps / Decimal("10000")
    raw = (quote.ask if side == "BUY" else quote.bid) * multiplier
    rounding = ROUND_CEILING if side == "BUY" else ROUND_FLOOR
    return (raw / min_tick).to_integral_value(rounding=rounding) * min_tick


def validate_position_ownership(
    broker_positions: Iterable[Position],
    owned_positions: Iterable[Position],
    target_symbols: Iterable[str],
) -> list[str]:
    broker = {item.symbol.upper(): item.quantity for item in broker_positions if item.quantity != 0}
    owned = {item.symbol.upper(): item.quantity for item in owned_positions if item.quantity != 0}
    relevant = set(target.upper() for target in target_symbols) | set(owned)
    conflicts: list[str] = []
    for symbol in sorted(relevant):
        broker_quantity = broker.get(symbol, Decimal("0"))
        owned_quantity = owned.get(symbol, Decimal("0"))
        if abs(broker_quantity - owned_quantity) > QUANTITY_TOLERANCE:
            conflicts.append(symbol)
    return conflicts


def build_order_intents(
    *,
    budget_usd: Decimal,
    targets: Iterable[Target],
    owned_positions: Iterable[Position],
    quotes: dict[str, Quote],
    instruments: dict[str, Instrument],
) -> tuple[list[OrderIntent], list[OrderIntent]]:
    budget = investable_budget(budget_usd)
    owned = {position.symbol.upper(): position.quantity for position in owned_positions}
    target_list = list(targets)
    weight_total = sum((target.weight for target in target_list), Decimal("0"))
    if not target_list:
        raise ValueError("empty targets require explicit liquidation approval")
    if weight_total > Decimal("1.000001") or weight_total <= 0:
        raise ValueError("invalid target weights")
    desired: dict[str, Decimal] = {}
    for target in target_list:
        symbol = target.symbol.upper()
        instrument = instruments.get(symbol)
        quote = quotes.get(symbol)
        if not instrument or not instrument.approved or instrument.currency != "USD" or not instrument.primary_exchange:
            raise ValueError(f"instrument is not approved: {symbol}")
        if not quote:
            raise ValueError(f"quote is unavailable: {symbol}")
        buy_limit = marketable_limit("BUY", quote, instrument.min_tick)
        raw_quantity = budget * target.weight / buy_limit
        desired[symbol] = round_quantity(raw_quantity, instrument.size_increment, instrument.supports_fractional)

    sells: list[OrderIntent] = []
    buys: list[OrderIntent] = []
    for symbol in sorted(set(owned) | set(desired)):
        current = owned.get(symbol, Decimal("0"))
        target_quantity = desired.get(symbol, Decimal("0"))
        delta = target_quantity - current
        if abs(delta) <= QUANTITY_TOLERANCE:
            continue
        instrument = instruments.get(symbol)
        quote = quotes.get(symbol)
        if not instrument or not quote:
            raise ValueError(f"cannot price owned position: {symbol}")
        side = "BUY" if delta > 0 else "SELL"
        quantity = round_quantity(abs(delta), instrument.size_increment, instrument.supports_fractional)
        if quantity <= 0:
            continue
        intent = OrderIntent(
            symbol=symbol,
            conid=instrument.conid,
            side=side,
            quantity=quantity,
            limit_price=marketable_limit(side, quote, instrument.min_tick),
            min_tick=instrument.min_tick,
        )
        (buys if side == "BUY" else sells).append(intent)
    return sells, buys
