from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, time
from decimal import Decimal
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from .policy import (
    InsufficientTargetCoverageError,
    Instrument,
    OrderIntent,
    Position,
    Quote,
    Target,
    build_order_intents,
    calculate_sizing_coverage,
    validate_position_ownership,
)


NEW_YORK = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class ExecutionFill:
    exec_id: str
    quantity: Decimal
    price: Decimal
    commission: Decimal = Decimal("0")
    commission_currency: str = "USD"
    executed_at: str = ""
    raw_execution: dict[str, Any] | None = None


@dataclass(frozen=True)
class BrokerOrder:
    client_order_key: str
    symbol: str
    side: str
    requested_quantity: Decimal
    filled_quantity: Decimal
    status: str
    limit_price: Decimal
    conid: int | None = None
    average_fill_price: Decimal | None = None
    ib_order_id: int | None = None
    ib_perm_id: int | None = None


@dataclass(frozen=True)
class BrokerExecution:
    client_order_key: str
    symbol: str
    side: str
    conid: int | None
    ib_order_id: int
    ib_perm_id: int | None
    fill: ExecutionFill


@dataclass(frozen=True)
class BrokerSnapshot:
    account_id: str
    positions: list[Position]
    settled_cash_usd: Decimal
    account_type: str = "UNKNOWN"
    open_orders: tuple[BrokerOrder, ...] = ()
    executions: tuple[BrokerExecution, ...] = ()

    @property
    def open_order_refs(self) -> set[str]:
        return {order.client_order_key for order in self.open_orders}

    @property
    def execution_refs(self) -> set[str]:
        return {execution.client_order_key for execution in self.executions}


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
    conid: int | None = None
    ib_order_id: int | None = None
    ib_perm_id: int | None = None
    commission: Decimal = Decimal("0")
    commission_currency: str = "USD"
    fills: tuple[ExecutionFill, ...] = ()
    recovered: bool = False
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
    def fill(self, order_id: str | None, result: ExecutionResult, fill: ExecutionFill) -> None: ...
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


class MarketUnavailableError(RuntimeError):
    pass


class ExecutionCancelledError(RuntimeError):
    pass


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
            waiting_status = "awaiting_settlement" if status == "awaiting_settlement" else "awaiting_market"
            message = (
                "Waiting for settled USD cash before the next buy phase."
                if waiting_status == "awaiting_settlement"
                else "Waiting for the 10:00-15:30 New York execution window."
            )
            self.reporter.plan_status(plan_id, waiting_status, error=message)
            return
        try:
            self._execute(command, now=now)
        except ExecutionCancelledError:
            self.broker.cancel_plan_orders(plan_id)
            self.reporter.plan_status(plan_id, "cancelled", error="Execution stopped by the remote kill switch.")
        except MarketUnavailableError as error:
            message = str(error)
            self.reporter.plan_status(plan_id, "awaiting_market", error=message)
            self.reporter.alert("awaiting_market", "warning", message, {"plan_id": plan_id})
        except Exception as error:
            message = str(error)
            preflight = error.preflight if isinstance(error, InsufficientTargetCoverageError) else None
            self.reporter.plan_status(plan_id, "blocked", error=message, preflight=preflight)
            event_type = "rebalance_blocked"
            if "settled cash" in message:
                event_type = "balance_anomaly"
            elif "manual position" in message or "manual open order" in message:
                event_type = "manual_position_conflict"
            self.reporter.alert(event_type, "critical", message, {"plan_id": plan_id})

    def _execute(self, command: dict[str, Any], *, now: datetime) -> None:
        plan_id = str(command["plan_id"])
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
        manual_open_orders = sorted({
            order.symbol for order in snapshot.open_orders
            if order.symbol in symbols and not order.client_order_key.startswith("hib:")
        })
        if manual_open_orders:
            raise ValueError(f"manual open order overlap: {', '.join(manual_open_orders)}")
        instruments = self.broker.resolve_instruments(symbols)
        closed = [symbol for symbol, instrument in instruments.items() if not instrument_session_is_open(instrument, now)]
        if closed:
            raise MarketUnavailableError(
                f"regular trading session is closed or ambiguous: {', '.join(sorted(closed))}"
            )
        quotes = self.broker.fresh_quotes(symbols)
        for instrument in instruments.values():
            self.reporter.instrument(instrument)
        configured_budget = _decimal(command["budget_usd"])
        strategy_cash = max(Decimal("0"), _decimal(command.get("strategy_cash_usd", configured_budget)))
        owned_market_value = sum(
            (position.quantity * quotes[position.symbol].bid for position in owned_positions),
            Decimal("0"),
        )
        strategy_equity = strategy_cash + owned_market_value
        capital_base = min(configured_budget, max(Decimal("0"), strategy_equity))
        coverage = calculate_sizing_coverage(
            budget_usd=capital_base, targets=targets,
            quotes=quotes, instruments=instruments,
        )
        if not coverage.complete:
            raise InsufficientTargetCoverageError(coverage)
        sells, buys = build_order_intents(
            budget_usd=capital_base,
            targets=targets,
            owned_positions=owned_positions,
            quotes=quotes,
            instruments=instruments,
        )
        sell_proceeds = sum((intent.quantity * quotes[intent.symbol].bid for intent in sells), Decimal("0"))
        buy_cost = sum((intent.quantity * intent.limit_price for intent in buys), Decimal("0"))
        has_prior_system_sells = any(
            str(order.get("side")) == "SELL" and _decimal(order.get("filled_quantity", 0)) > 0
            for order in command.get("existing_orders", [])
        )
        broker_cash_shortfall = max(Decimal("0"), buy_cost - snapshot.settled_cash_usd)
        strategy_cash_shortfall = max(Decimal("0"), buy_cost - strategy_cash)
        what_if_intents = sells if sells and (broker_cash_shortfall > 0 or strategy_cash_shortfall > 0) else sells + buys
        what_if_errors = self.broker.what_if(what_if_intents)
        if what_if_errors:
            raise ValueError("IBKR WhatIf failed: " + "; ".join(what_if_errors))
        preflight = {
            "account_match": True,
            "account_type": snapshot.account_type,
            "manual_overlap": False,
            "target_count": coverage.target_count,
            "covered_target_count": coverage.covered_target_count,
            "target_coverage": f"{coverage.covered_target_count}/{coverage.target_count}",
            "minimum_budget_usd": str(coverage.minimum_budget_usd),
            "uncovered_symbols": [],
            "instrument_count": len(instruments),
            "quote_count": len(quotes),
            "sell_count": len(sells),
            "buy_count": len(buys),
            "settled_cash_usd": str(snapshot.settled_cash_usd),
            "strategy_cash_usd": str(strategy_cash),
            "strategy_equity_usd": str(strategy_equity),
            "capital_base_usd": str(capital_base),
            "estimated_sell_proceeds_usd": str(sell_proceeds),
            "estimated_buy_cost_usd": str(buy_cost),
            "settled_cash_shortfall_usd": str(broker_cash_shortfall),
            "strategy_cash_shortfall_usd": str(strategy_cash_shortfall),
            "same_day_sale_proceeds_counted": False,
            "what_if": "sell_phase_passed_buy_phase_deferred" if what_if_intents == sells and buys else "passed",
        }
        self.reporter.plan_status(plan_id, "preflight", preflight=preflight)
        if not self.execution_enabled:
            raise ValueError("local execution gate IBKR_EXECUTION_ENABLED is disabled")
        revision = int(command.get("command_revision", 1))
        if sells:
            self.reporter.plan_status(plan_id, "selling", preflight=preflight)
            sell_results = self.broker.execute_phase(plan_id, sells, revision=revision, max_attempts=3)
            self._report_results(plan_id, sell_results)
            if not self._phase_completed(sells, sell_results):
                self.reporter.plan_status(plan_id, "partial", error="Sell phase did not fully complete; buys were not submitted.")
                self.reporter.alert("partial_rebalance", "warning", "Sell phase is partial; buys were not submitted.", {"plan_id": plan_id})
                return
            strategy_cash += sum(
                (
                    fill.quantity * fill.price - fill.commission
                    for result in sell_results
                    for fill in result.fills
                ),
                Decimal("0"),
            )
            snapshot = self.broker.reconcile()
            preflight["settled_cash_after_sells_usd"] = str(snapshot.settled_cash_usd)
            preflight["strategy_cash_after_sells_usd"] = str(strategy_cash)
            broker_cash_shortfall = max(Decimal("0"), buy_cost - snapshot.settled_cash_usd)
            strategy_cash_shortfall = max(Decimal("0"), buy_cost - strategy_cash)
            preflight["settled_cash_shortfall_usd"] = str(broker_cash_shortfall)
            preflight["strategy_cash_shortfall_usd"] = str(strategy_cash_shortfall)
        if buys and buy_cost > strategy_cash:
            raise ValueError(
                f"strategy-owned cash is insufficient for purchases: required ${buy_cost}, "
                f"available ${strategy_cash}; unrelated account cash cannot top up this strategy"
            )
        if buys and buy_cost > snapshot.settled_cash_usd:
            if sells or has_prior_system_sells or str(command.get("status")) == "awaiting_settlement":
                message = (
                    "Sell phase completed, but purchases are waiting for IBKR settled USD cash; "
                    "same-day sale proceeds are never counted."
                )
                self.reporter.plan_status(plan_id, "awaiting_settlement", error=message, preflight=preflight)
                self.reporter.alert("awaiting_settlement", "warning", message, {"plan_id": plan_id})
                return
            raise ValueError(
                f"settled cash is insufficient for purchases: required ${buy_cost}, "
                f"available ${snapshot.settled_cash_usd}; margin borrowing is disabled"
            )
        if buys:
            buy_what_if_errors = self.broker.what_if(buys) if what_if_intents != sells + buys else []
            if buy_what_if_errors:
                raise ValueError("IBKR buy-phase WhatIf failed: " + "; ".join(buy_what_if_errors))
            preflight["what_if"] = "passed"
            self.reporter.plan_status(plan_id, "buying", preflight=preflight)
            buy_results = self.broker.execute_phase(plan_id, buys, revision=revision, max_attempts=3)
            self._report_results(plan_id, buy_results)
            if not self._phase_completed(buys, buy_results):
                self.reporter.plan_status(plan_id, "partial", error="Buy phase partially filled; remaining quantities will retry next session.")
                self.reporter.alert("partial_rebalance", "warning", "Buy phase is partial; remaining quantity will retry next session.", {"plan_id": plan_id})
                return
        self.reporter.plan_status(plan_id, "completed", preflight=preflight)

    def _report_results(self, plan_id: str, results: list[ExecutionResult]) -> None:
        for result in results:
            order_id = self.reporter.order(plan_id, result)
            for fill in result.fills:
                self.reporter.fill(order_id, result, fill)
            if result.status in {"rejected", "error"}:
                self.reporter.alert(
                    "order_rejected",
                    "critical",
                    result.error or f"{result.side} {result.symbol} was rejected.",
                    {"plan_id": plan_id, "client_order_key": result.client_order_key},
                )

    @staticmethod
    def _phase_completed(intents: list[OrderIntent], results: list[ExecutionResult]) -> bool:
        requested = {intent.symbol: intent.quantity for intent in intents}
        filled: dict[str, Decimal] = {}
        for result in results:
            filled[result.symbol] = filled.get(result.symbol, Decimal("0")) + result.filled_quantity
        return all(filled.get(symbol, Decimal("0")) >= quantity for symbol, quantity in requested.items())
