from __future__ import annotations

import threading
import time
from dataclasses import replace
from decimal import Decimal
from typing import Any

try:
    from ibapi.client import EClient
    from ibapi.contract import Contract
    from ibapi.execution import ExecutionFilter
    from ibapi.order import Order
    from ibapi.wrapper import EWrapper
except ImportError as error:  # pragma: no cover - depends on the official IBKR install
    raise RuntimeError(
        "Install ibapi from the TWS API package matching the installed IB Gateway version. "
        "Do not use an unversioned third-party PyPI copy."
    ) from error

from .engine import BrokerSnapshot, ExecutionResult
from .policy import Instrument, OrderIntent, Position, Quote, marketable_limit


class IbGateway(EWrapper, EClient):
    def __init__(self, *, host: str, port: int, client_id: int, expected_account: str) -> None:
        EWrapper.__init__(self)
        EClient.__init__(self, self)
        self.host = host
        self.port = port
        self.client_id = client_id
        self.expected_account = expected_account.upper()
        self._thread: threading.Thread | None = None
        self._lock = threading.RLock()
        self._request_id = 10_000
        self._next_order_id: int | None = None
        self._managed_accounts: list[str] = []
        self._positions: list[Position] = []
        self._settled_cash = Decimal("0")
        self._open_orders: dict[int, dict[str, Any]] = {}
        self._executions: dict[str, dict[str, Any]] = {}
        self._order_status: dict[int, dict[str, Any]] = {}
        self._commissions: dict[str, Decimal] = {}
        self._contracts: dict[int, list[Any]] = {}
        self._quotes: dict[int, dict[str, Any]] = {}
        self._what_if: dict[int, Any] = {}
        self._errors: dict[int, list[str]] = {}
        self._events = {name: threading.Event() for name in (
            "ready", "positions", "orders", "executions", "account",
        )}
        self._request_events: dict[int, threading.Event] = {}

    def connect_and_start(self, timeout: float = 15) -> None:
        if self.isConnected():
            return
        self.connect(self.host, self.port, self.client_id)
        self._thread = threading.Thread(target=self.run, name="ibapi-network", daemon=True)
        self._thread.start()
        if not self._events["ready"].wait(timeout):
            self.disconnect()
            raise RuntimeError("IB Gateway did not provide nextValidId and managed account in time")
        if self.expected_account not in self._managed_accounts:
            self.disconnect()
            raise RuntimeError("IB Gateway is authenticated to a different account")

    def close(self) -> None:
        if self.isConnected():
            self.disconnect()

    def nextValidId(self, orderId: int) -> None:  # noqa: N802
        with self._lock:
            self._next_order_id = max(orderId, self._next_order_id or orderId)
        if self._managed_accounts:
            self._events["ready"].set()

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802
        self._managed_accounts = [item.strip().upper() for item in accountsList.split(",") if item.strip()]
        if self._next_order_id is not None:
            self._events["ready"].set()

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = "") -> None:  # noqa: N802
        if errorCode in {2104, 2106, 2107, 2108, 2158}:
            return
        details = f"{errorCode}: {errorString}"
        if advancedOrderRejectJson:
            details += f" ({advancedOrderRejectJson})"
        with self._lock:
            self._errors.setdefault(reqId, []).append(details)
        event = self._request_events.get(reqId)
        if event and errorCode not in {2103, 2105, 2110}:
            event.set()

    def position(self, account: str, contract: Any, position: Decimal, avgCost: float) -> None:
        if account.upper() == self.expected_account and str(contract.secType) == "STK":
            self._positions.append(Position(str(contract.symbol).upper(), Decimal(str(position))))

    def positionEnd(self) -> None:  # noqa: N802
        self._events["positions"].set()

    def openOrder(self, orderId: int, contract: Any, order: Any, orderState: Any) -> None:  # noqa: N802
        order_ref = str(getattr(order, "orderRef", "") or "")
        self._open_orders[orderId] = {"ref": order_ref, "contract": contract, "order": order, "state": orderState}
        if bool(getattr(order, "whatIf", False)):
            self._what_if[orderId] = orderState
            event = self._request_events.get(orderId)
            if event:
                event.set()

    def openOrderEnd(self) -> None:  # noqa: N802
        self._events["orders"].set()

    def orderStatus(  # noqa: N802
        self, orderId: int, status: str, filled: Decimal, remaining: Decimal,
        avgFillPrice: float, permId: int, parentId: int, lastFillPrice: float,
        clientId: int, whyHeld: str, mktCapPrice: float,
    ) -> None:
        self._order_status[orderId] = {
            "status": status, "filled": Decimal(str(filled)), "remaining": Decimal(str(remaining)),
            "average_fill_price": Decimal(str(avgFillPrice)), "perm_id": permId,
        }

    def execDetails(self, reqId: int, contract: Any, execution: Any) -> None:  # noqa: N802
        self._executions[str(execution.execId)] = {
            "req_id": reqId, "order_id": int(execution.orderId), "perm_id": int(execution.permId),
            "ref": str(getattr(execution, "orderRef", "") or ""), "symbol": str(contract.symbol).upper(),
            "shares": Decimal(str(execution.shares)), "price": Decimal(str(execution.price)),
        }

    def execDetailsEnd(self, reqId: int) -> None:  # noqa: N802
        event = self._request_events.get(reqId)
        if event:
            event.set()
        self._events["executions"].set()

    def commissionReport(self, commissionReport: Any) -> None:  # noqa: N802
        self._commissions[str(commissionReport.execId)] = Decimal(str(commissionReport.commission))

    def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str) -> None:  # noqa: N802
        if account.upper() == self.expected_account and tag == "SettledCash" and currency == "USD":
            self._settled_cash = Decimal(value)

    def accountSummaryEnd(self, reqId: int) -> None:  # noqa: N802
        event = self._request_events.get(reqId)
        if event:
            event.set()
        self._events["account"].set()

    def contractDetails(self, reqId: int, contractDetails: Any) -> None:  # noqa: N802
        self._contracts.setdefault(reqId, []).append(contractDetails)

    def contractDetailsEnd(self, reqId: int) -> None:  # noqa: N802
        event = self._request_events.get(reqId)
        if event:
            event.set()

    def tickPrice(self, reqId: int, tickType: int, price: float, attrib: Any) -> None:  # noqa: N802
        if price <= 0:
            return
        quote = self._quotes.setdefault(reqId, {"received": time.monotonic()})
        if tickType == 1:
            quote["bid"] = Decimal(str(price))
        elif tickType == 2:
            quote["ask"] = Decimal(str(price))
        quote["received"] = time.monotonic()
        if "bid" in quote and "ask" in quote:
            event = self._request_events.get(reqId)
            if event:
                event.set()

    def tickSnapshotEnd(self, reqId: int) -> None:  # noqa: N802
        event = self._request_events.get(reqId)
        if event:
            event.set()

    def reconcile(self) -> BrokerSnapshot:
        self.connect_and_start()
        for event in ("positions", "orders", "executions", "account"):
            self._events[event].clear()
        self._positions = []
        self._open_orders = {}
        self._executions = {}
        self._settled_cash = Decimal("0")
        execution_request = self._new_request()
        account_request = self._new_request()
        self.reqPositions()
        self.reqOpenOrders()
        self.reqExecutions(execution_request, ExecutionFilter())
        self.reqAccountSummary(account_request, "All", "SettledCash")
        self._wait(self._events["positions"], 15, "positions reconciliation")
        self._wait(self._events["orders"], 15, "open-order reconciliation")
        self._wait(self._events["executions"], 15, "execution reconciliation")
        self._wait(self._events["account"], 15, "account reconciliation")
        self.cancelAccountSummary(account_request)
        return BrokerSnapshot(
            account_id=self.expected_account,
            positions=list(self._positions),
            settled_cash_usd=self._settled_cash,
            open_order_refs={str(item["ref"]) for item in self._open_orders.values() if item["ref"]},
            execution_refs={str(item["ref"]) for item in self._executions.values() if item["ref"]},
        )

    def resolve_instruments(self, symbols: list[str]) -> dict[str, Instrument]:
        resolved: dict[str, Instrument] = {}
        for symbol in symbols:
            request_id = self._new_request()
            contract = Contract()
            contract.symbol = symbol
            contract.secType = "STK"
            contract.exchange = "SMART"
            contract.currency = "USD"
            self.reqContractDetails(request_id, contract)
            self._wait_request(request_id, 15, f"contract details for {symbol}")
            matches = [
                item for item in self._contracts.get(request_id, [])
                if str(item.contract.symbol).upper() == symbol and str(item.contract.currency) == "USD"
                and str(getattr(item.contract, "primaryExchange", "") or "")
            ]
            if len(matches) != 1:
                raise RuntimeError(f"contract mapping for {symbol} is not unique")
            details = matches[0]
            increment = Decimal(str(getattr(details, "sizeIncrement", 1) or 1))
            liquid_hours = str(getattr(details, "liquidHours", "") or "")
            time_zone = str(getattr(details, "timeZoneId", "") or "")
            resolved[symbol] = Instrument(
                symbol=symbol, conid=int(details.contract.conId), currency="USD",
                primary_exchange=str(details.contract.primaryExchange),
                min_tick=Decimal(str(details.minTick)), size_increment=increment,
                supports_fractional=False, approved=bool(liquid_hours and time_zone),
                exchange="SMART",
                min_size=Decimal(str(getattr(details, "minSize", 1) or 1)),
                liquid_hours=liquid_hours,
                time_zone=time_zone,
            )
        return resolved

    def fresh_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        quotes: dict[str, Quote] = {}
        instruments = self.resolve_instruments(symbols)
        for symbol in symbols:
            request_id = self._new_request()
            contract = self._contract(instruments[symbol])
            self.reqMktData(request_id, contract, "", True, False, [])
            self._wait_request(request_id, 12, f"NBBO for {symbol}")
            raw = self._quotes.get(request_id, {})
            if "bid" not in raw or "ask" not in raw:
                raise RuntimeError(f"fresh NBBO unavailable for {symbol}")
            quotes[symbol] = Quote(symbol, raw["bid"], raw["ask"], time.monotonic() - raw["received"])
        return quotes

    def what_if(self, intents: list[OrderIntent]) -> list[str]:
        failures: list[str] = []
        for intent in intents:
            order_id = self._take_order_id()
            order = self._order(intent, f"hib-whatif:{order_id}")
            order.whatIf = True
            self.placeOrder(order_id, self._contract_from_intent(intent), order)
            self._wait_request(order_id, 15, f"WhatIf {intent.symbol}", allow_errors=True)
            errors = self._errors.pop(order_id, [])
            state = self._what_if.pop(order_id, None)
            warning = str(getattr(state, "warningText", "") or "") if state else ""
            if errors or not state:
                failures.append(f"{intent.symbol}: {'; '.join(errors) or 'no WhatIf response'}")
            elif warning:
                failures.append(f"{intent.symbol}: {warning}")
        return failures

    def execute_phase(self, plan_id: str, intents: list[OrderIntent], *, revision: int, max_attempts: int) -> list[ExecutionResult]:
        return [self._execute_one(plan_id, intent, revision, max_attempts) for intent in intents]

    def _execute_one(self, plan_id: str, intent: OrderIntent, revision: int, max_attempts: int) -> ExecutionResult:
        filled_total = Decimal("0")
        average_numerator = Decimal("0")
        last_result: ExecutionResult | None = None
        for attempt in range(1, max_attempts + 1):
            remaining = intent.quantity - filled_total
            if remaining <= 0:
                break
            client_key = f"hib:{plan_id}:{intent.symbol}:{intent.side}:r{revision}:a{attempt}"
            snapshot = self.reconcile()
            if client_key in snapshot.open_order_refs or client_key in snapshot.execution_refs:
                return ExecutionResult(client_key, intent.symbol, intent.side, intent.quantity, filled_total, "partially_filled", intent.limit_price, error="existing broker order requires reconciliation")
            current_intent = replace(intent, quantity=remaining)
            if attempt > 1:
                quote = self.fresh_quotes([intent.symbol])[intent.symbol]
                current_intent = replace(current_intent, limit_price=marketable_limit(intent.side, quote, intent.min_tick))
            order_id = self._take_order_id()
            order = self._order(current_intent, client_key)
            self.placeOrder(order_id, self._contract_from_intent(current_intent), order)
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                status = self._order_status.get(order_id, {})
                if str(status.get("status")) in {"Filled", "Cancelled", "ApiCancelled", "Inactive"}:
                    break
                time.sleep(0.25)
            status = self._order_status.get(order_id, {})
            attempt_filled = Decimal(str(status.get("filled", 0)))
            average_price = Decimal(str(status.get("average_fill_price", 0)))
            if attempt_filled > 0:
                filled_total += attempt_filled
                average_numerator += attempt_filled * average_price
            if filled_total < intent.quantity:
                self.cancelOrder(order_id, "")
                time.sleep(1)
            executions = [item for item in self._executions.items() if int(item[1].get("order_id", -1)) == order_id]
            exec_id = executions[-1][0] if executions else None
            commission = sum((self._commissions.get(item[0], Decimal("0")) for item in executions), Decimal("0"))
            final_status = "filled" if filled_total >= intent.quantity else "partially_filled"
            if str(status.get("status")) == "Inactive" or self._errors.get(order_id):
                final_status = "rejected"
            last_result = ExecutionResult(
                client_order_key=client_key, symbol=intent.symbol, side=intent.side,
                requested_quantity=intent.quantity, filled_quantity=filled_total, status=final_status,
                limit_price=current_intent.limit_price,
                average_fill_price=(average_numerator / filled_total if filled_total else None),
                ib_order_id=order_id, ib_perm_id=int(status.get("perm_id") or 0) or None,
                exec_id=exec_id, commission=commission,
                error="; ".join(self._errors.get(order_id, [])),
            )
            if final_status == "filled" or final_status == "rejected":
                break
        return last_result or ExecutionResult(
            f"hib:{plan_id}:{intent.symbol}:{intent.side}:r{revision}:a0",
            intent.symbol, intent.side, intent.quantity, Decimal("0"), "error", intent.limit_price,
            error="order was not submitted",
        )

    def cancel_plan_orders(self, plan_id: str) -> None:
        self.reconcile()
        prefix = f"hib:{plan_id}:"
        for order_id, details in list(self._open_orders.items()):
            if str(details.get("ref", "")).startswith(prefix):
                self.cancelOrder(order_id, "")

    def _new_request(self) -> int:
        with self._lock:
            self._request_id += 1
            request_id = self._request_id
            self._request_events[request_id] = threading.Event()
            return request_id

    def _take_order_id(self) -> int:
        with self._lock:
            if self._next_order_id is None:
                raise RuntimeError("IBKR did not provide nextValidId")
            order_id = self._next_order_id
            self._next_order_id += 1
            self._request_events[order_id] = threading.Event()
            return order_id

    def _wait_request(self, request_id: int, timeout: float, label: str, allow_errors: bool = False) -> None:
        event = self._request_events[request_id]
        self._wait(event, timeout, label)
        if self._errors.get(request_id) and not allow_errors:
            raise RuntimeError(f"{label}: {'; '.join(self._errors[request_id])}")

    @staticmethod
    def _wait(event: threading.Event, timeout: float, label: str) -> None:
        if not event.wait(timeout):
            raise TimeoutError(f"timed out waiting for {label}")

    @staticmethod
    def _contract(instrument: Instrument) -> Contract:
        contract = Contract()
        contract.conId = instrument.conid
        contract.symbol = instrument.symbol
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.primaryExchange = instrument.primary_exchange
        contract.currency = instrument.currency
        return contract

    @staticmethod
    def _contract_from_intent(intent: OrderIntent) -> Contract:
        contract = Contract()
        contract.conId = intent.conid
        contract.symbol = intent.symbol
        contract.secType = "STK"
        contract.exchange = "SMART"
        contract.currency = "USD"
        return contract

    @staticmethod
    def _order(intent: OrderIntent, order_ref: str) -> Order:
        order = Order()
        order.action = intent.side
        order.orderType = "LMT"
        order.totalQuantity = intent.quantity
        order.lmtPrice = float(intent.limit_price)
        order.tif = "DAY"
        order.outsideRth = False
        order.transmit = True
        order.orderRef = order_ref
        return order
