from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, time
from decimal import Decimal
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from .policy import (
    Instrument,
    OrderIntent,
    Position,
    Quote,
    Target,
    build_order_intents,
    validate_position_ownership,
)


NEW_YORK = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class BrokerSnapshot:
    account_id: str
    positions: list[Position]
    settled_cash_usd: Decimal
    open_order_refs: set[str]
    execution_refs: set[str]


@dataclass(frozen=True)
class ExecutionResult:
    client_order_key: str
    symbol: str
    side: str
    requested_quantity: Decimal
    filled_quantity: Decimal
    status: str
    limit_price: Decimal
    average_fill_price: Decimal | None = None
    ib_order_id: int | None = None
    ib_perm_id: int | None = None
    exec_id: str | None = None
    commission: Decimal = Decimal("0")
    error: str = ""


class Broker(Protocol):
    def reconcile(self) -> BrokerSnapshot: ...
    def resolve_instruments(self, symbols: list[str]) -> dict[str, Instrument]: ...
    def fresh_quotes(self, symbols: list[str]) -> dict[str, Quote]: ...
    def what_if(self, intents: list[OrderIntent]) -> list[str]: ...
    def execute_phase(
        self,
        plan_id: str,
        intents: list[OrderIntent],
        *,
        revision: int,
        max_attempts: int,
    ) -> list[ExecutionResult]: ...
    def cancel_plan_orders(self, plan_id: str) -> None: ...


class Reporter(Protocol):
    def plan_status(self, plan_id: str, status: str, *, error: str = "", preflight: dict[str, Any] | None = None) -> None: ...
    def order(self, plan_id: str, result: ExecutionResult) -> str | None: ...
    def fill(self, order_id: str | None, result: ExecutionResult) -> None: ...
    def positions(self, strategy_link_id: str, positions: list[Position]) -> None: ...
    def instrument(self, instrument: Instrument) -> None: ...
    def alert(self, event_type: str, severity: str, message: str, payload: dict[str, Any] | None = None) -> None: ...


def in_execution_window(now: datetime) -> bool:
    local = now.astimezone(NEW_YORK)
    return local.weekday() < 5 and time(10, 0) <= local.time().replace(tzinfo=None) <= time(15, 30)


def instrument_session_is_open(instrument: Instrument, now: datetime) -> bool:
    if not instrument.liquid_hours:
        return instrument.approved
    zone_name = {
        "US/Eastern": "America/New_York",
        "EST5EDT": "America/New_York",
    }.get(instrument.time_zone, instrument.time_zone or "America/New_York")
    local = now.astimezone(ZoneInfo(zone_name))
    for segment in instrument.liquid_hours.split(";"):
        if not segment or "CLOSED" in segment or "-" not in segment:
            continue
        start_raw, end_raw = segment.split("-", 1)
        if ":" not in start_raw:
            continue
        start_date, start_time = start_raw.split(":", 1)
        if ":" in end_raw:
            end_date, end_time = end_raw.split(":", 1)
        else:
            end_date, end_time = start_date, end_raw
        try:
            start = datetime.strptime(start_date + start_time, "%Y%m%d%H%M").replace(tzinfo=local.tzinfo)
            end = datetime.strptime(end_date + end_time, "%Y%m%d%H%M").replace(tzinfo=local.tzinfo)
        except ValueError:
            continue
        if start <= local <= end:
            return True
    return False


def _decimal(value: Any) -> Decimal:
    return Decimal(str(value))


def _event_id(plan_id: str, kind: str, message: str) -> str:
    digest = hashlib.sha256(message.encode("utf-8")).hexdigest()[:12]
    return f"{plan_id}:{kind}:{digest}"


class ExecutionEngine:
    def __init__(self, broker: Broker, reporter: Reporter, *, account_id: str, execution_enabled: bool) -> None:
        self.broker = broker
        self.reporter = reporter
        self.account_id = account_id.upper()
        self.execution_enabled = execution_enabled

    def handle(self, command: dict[str, Any], *, now: datetime) -> None:
        plan_id = str(command["plan_id"])
        status = str(command["status"])
        if status == "cancel_requested":
            self.broker.cancel_plan_orders(plan_id)
            self.reporter.plan_status(plan_id, "cancelled")
            return
        if not in_execution_window(now):
            self.reporter.plan_status(plan_id, "awaiting_market", error="Waiting for the 10:00-15:30 New York execution window.")
            return
        try:
            self._execute(command, now=now)
        except Exception as error:
            message = str(error)
            self.reporter.plan_status(plan_id, "blocked", error=message)
            event_type = "rebalance_blocked"
            if "settled cash" in message:
                event_type = "balance_anomaly"
            elif "manual position" in message:
                event_type = "manual_position_conflict"
            self.reporter.alert(event_type, "critical", message, {"plan_id": plan_id})

    def _execute(self, command: dict[str, Any], *, now: datetime) -> None:
        plan_id = str(command["plan_id"])
        strategy_link_id = str(command["strategy_link_id"])
        if str(command.get("mode")) != "paper":
            raise ValueError("executor refuses non-Paper commands")
        targets = [
            Target(symbol=str(row["ticker"]).upper(), weight=_decimal(row["weight"]))
            for row in command.get("target_holdings", [])
        ]
        if not targets:
            raise ValueError("empty targets require explicit liquidation approval")
        owned_positions = [
            Position(symbol=str(row["symbol"]).upper(), quantity=_decimal(row["quantity"]))
            for row in command.get("owned_positions", [])
        ]
        snapshot = self.broker.reconcile()
        if snapshot.account_id.upper() != self.account_id:
            raise ValueError("IBKR account does not match paired account")
        target_symbols = [target.symbol for target in targets]
        conflicts = validate_position_ownership(snapshot.positions, owned_positions, target_symbols)
        if conflicts:
            raise ValueError(f"manual position overlap or drift: {', '.join(conflicts)}")
        symbols = sorted(set(target_symbols) | {position.symbol for position in owned_positions})
        instruments = self.broker.resolve_instruments(symbols)
        closed = [symbol for symbol, instrument in instruments.items() if not instrument_session_is_open(instrument, now)]
        if closed:
            raise ValueError(f"regular trading session is closed or ambiguous: {', '.join(sorted(closed))}")
        quotes = self.broker.fresh_quotes(symbols)
        for instrument in instruments.values():
            self.reporter.instrument(instrument)
        sells, buys = build_order_intents(
            budget_usd=_decimal(command["budget_usd"]),
            targets=targets,
            owned_positions=owned_positions,
            quotes=quotes,
            instruments=instruments,
        )
        sell_proceeds = sum((intent.quantity * quotes[intent.symbol].bid for intent in sells), Decimal("0"))
        buy_cost = sum((intent.quantity * intent.limit_price for intent in buys), Decimal("0"))
        if buy_cost > snapshot.settled_cash_usd + sell_proceeds:
            raise ValueError("settled cash plus same-settlement sale proceeds is insufficient")
        what_if_errors = self.broker.what_if(sells + buys)
        if what_if_errors:
            raise ValueError("IBKR WhatIf failed: " + "; ".join(what_if_errors))
        preflight = {
            "account_match": True,
            "manual_overlap": False,
            "instrument_count": len(instruments),
            "quote_count": len(quotes),
            "sell_count": len(sells),
            "buy_count": len(buys),
            "settled_cash_usd": str(snapshot.settled_cash_usd),
            "estimated_sell_proceeds_usd": str(sell_proceeds),
            "estimated_buy_cost_usd": str(buy_cost),
            "what_if": "passed",
        }
        self.reporter.plan_status(plan_id, "preflight", preflight=preflight)
        if not self.execution_enabled:
            raise ValueError("local execution gate IBKR_EXECUTION_ENABLED is disabled")
        revision = int(command.get("command_revision", 1))
        if sells:
            self.reporter.plan_status(plan_id, "selling", preflight=preflight)
            sell_results = self.broker.execute_phase(plan_id, sells, revision=revision, max_attempts=3)
            self._report_results(plan_id, sell_results)
            if any(result.status != "filled" for result in sell_results):
                self._sync_owned(strategy_link_id, target_symbols, owned_positions)
                self.reporter.plan_status(plan_id, "partial", error="Sell phase did not fully complete; buys were not submitted.")
                self.reporter.alert("partial_rebalance", "warning", "Sell phase is partial; buys were not submitted.", {"plan_id": plan_id})
                return
        if buys:
            self.reporter.plan_status(plan_id, "buying", preflight=preflight)
            buy_results = self.broker.execute_phase(plan_id, buys, revision=revision, max_attempts=3)
            self._report_results(plan_id, buy_results)
            if any(result.status != "filled" for result in buy_results):
                self._sync_owned(strategy_link_id, target_symbols, owned_positions)
                self.reporter.plan_status(plan_id, "partial", error="Buy phase partially filled; remaining quantities will retry next session.")
                self.reporter.alert("partial_rebalance", "warning", "Buy phase is partial; remaining quantity will retry next session.", {"plan_id": plan_id})
                return
        self._sync_owned(strategy_link_id, target_symbols, owned_positions)
        self.reporter.plan_status(plan_id, "completed", preflight=preflight)

    def _sync_owned(self, strategy_link_id: str, target_symbols: list[str], owned_positions: list[Position]) -> None:
        final_snapshot = self.broker.reconcile()
        relevant = set(target_symbols) | {item.symbol for item in owned_positions}
        final_owned = [position for position in final_snapshot.positions if position.symbol in relevant]
        self.reporter.positions(strategy_link_id, final_owned)

    def _report_results(self, plan_id: str, results: list[ExecutionResult]) -> None:
        for result in results:
            order_id = self.reporter.order(plan_id, result)
            if result.exec_id and result.filled_quantity > 0 and result.average_fill_price:
                self.reporter.fill(order_id, result)
            if result.status in {"rejected", "error"}:
                self.reporter.alert(
                    "order_rejected",
                    "critical",
                    result.error or f"{result.side} {result.symbol} was rejected.",
                    {"plan_id": plan_id, "client_order_key": result.client_order_key},
                )
