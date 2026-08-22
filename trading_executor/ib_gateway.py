from __future__ import annotations

import threading
import time
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable
from zoneinfo import ZoneInfo

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

from .engine import BrokerExecution, BrokerOrder, BrokerSnapshot, ExecutionFill, ExecutionResult
from .journal import LocalJournal, execution_identity
from .policy import Instrument, OrderIntent, Position, Quote, marketable_limit


class IbGateway(EWrapper, EClient):
    def __init__(
        self,
        *,
        host: str,
        port: int,
        client_id: int,
        expected_account: str,
        journal: LocalJournal | None = None,
        submission_guard: Callable[[str], None] | None = None,
    ) -> None:
        EWrapper.__init__(self)
        EClient.__init__(self, self)
        self.host = host
        self.port = port
        self.client_id = client_id
        self.expected_account = expected_account.upper()
        self.journal = journal
        self.submission_guard = submission_guard
        self._thread: threading.Thread | None = None
        self._lock = threading.RLock()
        self._request_id = 10_000
        self._next_order_id: int | None = None
        self._managed_accounts: list[str] = []
        self._positions: list[Position] = []
        self._settled_cash = Decimal("0")
        self._account_type = "UNKNOWN"
        self._open_orders: dict[int, dict[str, Any]] = {}
        self._executions: dict[str, dict[str, Any]] = {}
        self._order_status: dict[int, dict[str, Any]] = {}
        self._commissions: dict[str, dict[str, Any]] = {}
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
        self._events["ready"].clear()
        self._managed_accounts = []
        self._next_order_id = None
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

    def error(self, reqId: int, *args: Any) -> None:  # noqa: N802
        # TWS API 10.33 added errorTime between reqId and errorCode. Accept the
        # current callback and the older shape so a Gateway/client upgrade
        # cannot terminate the network thread with a Python TypeError.
        if len(args) >= 3 and isinstance(args[1], int):
            _error_time, errorCode, errorString, *remaining = args
        elif len(args) >= 2:
            errorCode, errorString, *remaining = args
        else:
            return
        advancedOrderRejectJson = str(remaining[0]) if remaining else ""
        errorCode = int(errorCode)
        errorString = str(errorString)
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
        exec_id = str(execution.execId)
        details = {
            "req_id": reqId, "order_id": int(execution.orderId), "perm_id": int(execution.permId),
            "ref": str(getattr(execution, "orderRef", "") or ""), "symbol": str(contract.symbol).upper(),
            "conid": int(getattr(contract, "conId", 0) or 0) or None,
            "side": self._normalize_side(str(getattr(execution, "side", "") or "")),
            "shares": Decimal(str(execution.shares)), "price": Decimal(str(execution.price)),
            "time": self._execution_time(str(getattr(execution, "time", "") or "")),
        }
        self._executions[exec_id] = details
        if self.journal and details["ref"].startswith("hib:"):
            self.journal.record_broker_execution(exec_id, {
                **details,
                "shares": str(details["shares"]),
                "price": str(details["price"]),
            })

    def execDetailsEnd(self, reqId: int) -> None:  # noqa: N802
        event = self._request_events.get(reqId)
        if event:
            event.set()
        self._events["executions"].set()

    def commissionReport(self, commissionReport: Any) -> None:  # noqa: N802
        exec_id = str(commissionReport.execId)
        details = {
            "commission": Decimal(str(commissionReport.commission)),
            "currency": str(getattr(commissionReport, "currency", "USD") or "USD"),
        }
        self._commissions[exec_id] = details
        if self.journal:
            self.journal.record_commission(exec_id, {
                "commission": str(details["commission"]), "currency": details["currency"],
            })

    def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str) -> None:  # noqa: N802
        if account.upper() != self.expected_account:
            return
        if tag == "SettledCash" and currency == "USD":
            self._settled_cash = Decimal(value)
        elif tag == "AccountType":
            self._account_type = value.strip().upper() or "UNKNOWN"

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
        self._account_type = "UNKNOWN"
        execution_request = self._new_request()
        account_request = self._new_request()
        self.reqPositions()
        self.reqOpenOrders()
        execution_filter = ExecutionFilter()
        if hasattr(execution_filter, "acctCode"):
            execution_filter.acctCode = self.expected_account
        if hasattr(execution_filter, "lastNDays"):
            execution_filter.lastNDays = 7
        self.reqExecutions(execution_request, execution_filter)
        self.reqAccountSummary(account_request, "All", "SettledCash,AccountType")
        self._wait(self._events["positions"], 15, "positions reconciliation")
        self._wait(self._events["orders"], 15, "open-order reconciliation")
        self._wait(self._events["executions"], 15, "execution reconciliation")
        self._wait(self._events["account"], 15, "account reconciliation")
        self.cancelAccountSummary(account_request)
        if self.journal:
            for exec_id, details, commission in self.journal.broker_executions():
                self._executions.setdefault(exec_id, details)
                if commission:
                    self._commissions.setdefault(exec_id, commission)
        open_orders = tuple(self._broker_order(order_id, details) for order_id, details in self._open_orders.items())
        effective_ids = self._effective_execution_ids(list(self._executions))
        executions = tuple(
            self._broker_execution(exec_id, details)
            for exec_id, details in self._executions.items()
            if exec_id in effective_ids and details.get("ref") and details.get("side") in {"BUY", "SELL"}
        )
        return BrokerSnapshot(
            account_id=self.expected_account,
            positions=list(self._positions),
            settled_cash_usd=self._settled_cash,
            account_type=self._account_type,
            open_orders=open_orders,
            executions=executions,
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
        results: list[ExecutionResult] = []
        for intent in intents:
            results.extend(self._execute_one(plan_id, intent, revision, max_attempts))
        return results

    def _execute_one(self, plan_id: str, intent: OrderIntent, revision: int, max_attempts: int) -> list[ExecutionResult]:
        filled_total = Decimal("0")
        results: list[ExecutionResult] = []
        for attempt in range(1, max_attempts + 1):
            remaining = intent.quantity - filled_total
            if remaining <= 0:
                break
            client_key = f"hib:{plan_id}:{intent.symbol}:{intent.side}:r{revision}:a{attempt}"
            snapshot = self.reconcile()
            if any(
                order.symbol == intent.symbol and not order.client_order_key.startswith("hib:")
                for order in snapshot.open_orders
            ):
                raise RuntimeError(f"manual open order overlap appeared for {intent.symbol}")
            if client_key in snapshot.open_order_refs or client_key in snapshot.execution_refs:
                recovered = self._result_from_snapshot(snapshot, client_key, intent)
                if recovered:
                    results.append(recovered)
                    filled_total += recovered.filled_quantity
                if self.journal:
                    self.journal.mark_order_resolved(client_key)
                break
            if self.submission_guard:
                self.submission_guard(plan_id)
            current_intent = replace(intent, quantity=remaining)
            quote = self.fresh_quotes([intent.symbol])[intent.symbol]
            repriced_limit = marketable_limit(intent.side, quote, intent.min_tick)
            safe_limit = min(intent.limit_price, repriced_limit) if intent.side == "BUY" else max(intent.limit_price, repriced_limit)
            current_intent = replace(current_intent, limit_price=safe_limit)
            retry_what_if_errors = self.what_if([current_intent])
            if retry_what_if_errors:
                raise RuntimeError("IBKR retry WhatIf failed: " + "; ".join(retry_what_if_errors))
            order_id = self._take_order_id()
            order = self._order(current_intent, client_key)
            if self.journal:
                self.journal.prepare_order(client_key, {
                    "plan_id": plan_id, "symbol": current_intent.symbol, "side": current_intent.side,
                    "quantity": str(current_intent.quantity), "limit_price": str(current_intent.limit_price),
                    "conid": current_intent.conid,
                }, order_id)
            self.placeOrder(order_id, self._contract_from_intent(current_intent), order)
            if self.journal:
                self.journal.mark_order_submitted(client_key)
            deadline = time.monotonic() + 90
            next_guard_check = time.monotonic() + 10
            while time.monotonic() < deadline:
                status = self._order_status.get(order_id, {})
                if str(status.get("status")) in {"Filled", "Cancelled", "ApiCancelled", "Inactive"}:
                    break
                if self.submission_guard and time.monotonic() >= next_guard_check:
                    try:
                        self.submission_guard(plan_id)
                    except Exception:
                        self.cancelOrder(order_id, "")
                        raise
                    next_guard_check = time.monotonic() + 10
                time.sleep(0.25)
            status = self._order_status.get(order_id, {})
            reported_filled = Decimal(str(status.get("filled", 0)))
            average_price = Decimal(str(status.get("average_fill_price", 0)))
            if filled_total + reported_filled < intent.quantity:
                self.cancelOrder(order_id, "")
                time.sleep(1)
            executions = [
                item for item in self._executions.items()
                if int(item[1].get("order_id", -1)) == order_id
                and item[0] in self._effective_execution_ids([
                    candidate_id for candidate_id, candidate in self._executions.items()
                    if int(candidate.get("order_id", -1)) == order_id
                ])
            ]
            if executions:
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline and any(exec_id not in self._commissions for exec_id, _ in executions):
                    time.sleep(0.05)
            fills = tuple(self._execution_fill(exec_id, details) for exec_id, details in executions)
            attempt_filled = (
                sum((fill.quantity for fill in fills), Decimal("0"))
                if fills else reported_filled
            )
            if attempt_filled > 0:
                filled_total += attempt_filled
            commission = sum((fill.commission for fill in fills), Decimal("0"))
            final_status = "filled" if attempt_filled >= remaining else "partially_filled"
            if str(status.get("status")) == "Inactive" or self._errors.get(order_id):
                final_status = "rejected"
            results.append(ExecutionResult(
                client_order_key=client_key, symbol=intent.symbol, side=intent.side,
                requested_quantity=remaining, filled_quantity=attempt_filled, status=final_status,
                limit_price=current_intent.limit_price,
                average_fill_price=(average_price if attempt_filled else None), conid=intent.conid,
                ib_order_id=order_id, ib_perm_id=int(status.get("perm_id") or 0) or None,
                commission=commission, fills=fills,
                error="; ".join(self._errors.get(order_id, [])),
            ))
            if self.journal:
                self.journal.mark_order_resolved(client_key)
            if filled_total >= intent.quantity or final_status == "rejected":
                break
        if results:
            return results
        return [ExecutionResult(
            f"hib:{plan_id}:{intent.symbol}:{intent.side}:r{revision}:a0",
            intent.symbol, intent.side, intent.quantity, Decimal("0"), "error", intent.limit_price,
            conid=intent.conid, error="order was not submitted",
        )]

    def cancel_plan_orders(self, plan_id: str) -> None:
        self.reconcile()
        prefix = f"hib:{plan_id}:"
        for order_id, details in list(self._open_orders.items()):
            if str(details.get("ref", "")).startswith(prefix):
                self.cancelOrder(order_id, "")

    def _broker_order(self, order_id: int, details: dict[str, Any]) -> BrokerOrder:
        order = details["order"]
        contract = details["contract"]
        state = self._order_status.get(order_id, {})
        status = self._normalize_order_status(str(state.get("status") or getattr(details["state"], "status", "Submitted")))
        return BrokerOrder(
            client_order_key=str(details.get("ref", "")),
            symbol=str(getattr(contract, "symbol", "")).upper(),
            side=self._normalize_side(str(getattr(order, "action", ""))),
            requested_quantity=Decimal(str(getattr(order, "totalQuantity", 0))),
            filled_quantity=Decimal(str(state.get("filled", 0))),
            status=status,
            limit_price=Decimal(str(getattr(order, "lmtPrice", 0))),
            conid=int(getattr(contract, "conId", 0) or 0) or None,
            average_fill_price=Decimal(str(state["average_fill_price"])) if state.get("average_fill_price") else None,
            ib_order_id=order_id,
            ib_perm_id=int(state.get("perm_id") or getattr(order, "permId", 0) or 0) or None,
        )

    def _broker_execution(self, exec_id: str, details: dict[str, Any]) -> BrokerExecution:
        return BrokerExecution(
            client_order_key=str(details["ref"]), symbol=str(details["symbol"]), side=str(details["side"]),
            conid=details.get("conid"), ib_order_id=int(details["order_id"]),
            ib_perm_id=int(details.get("perm_id") or 0) or None,
            fill=self._execution_fill(exec_id, details),
        )

    def _execution_fill(self, exec_id: str, details: dict[str, Any]) -> ExecutionFill:
        commission = self._commissions.get(exec_id, {})
        return ExecutionFill(
            exec_id=exec_id,
            quantity=Decimal(str(details["shares"])),
            price=Decimal(str(details["price"])),
            commission=Decimal(str(commission.get("commission", 0))),
            commission_currency=str(commission.get("currency", "USD")),
            executed_at=str(details.get("time") or datetime.now(timezone.utc).isoformat()),
            raw_execution={
                "ib_order_id": details.get("order_id"), "ib_perm_id": details.get("perm_id"),
                "order_ref": details.get("ref"), "raw_time": details.get("time"),
            },
        )

    def _result_from_snapshot(self, snapshot: BrokerSnapshot, client_key: str, intent: OrderIntent) -> ExecutionResult | None:
        matching_executions = [item for item in snapshot.executions if item.client_order_key == client_key]
        matching_orders = [item for item in snapshot.open_orders if item.client_order_key == client_key]
        if matching_orders:
            order = matching_orders[0]
            effective_filled = sum((item.fill.quantity for item in matching_executions), Decimal("0"))
            return ExecutionResult(
                client_order_key=client_key, symbol=order.symbol, side=order.side,
                requested_quantity=order.requested_quantity,
                filled_quantity=effective_filled if matching_executions else order.filled_quantity,
                status=order.status, limit_price=order.limit_price, conid=order.conid,
                average_fill_price=order.average_fill_price, ib_order_id=order.ib_order_id,
                ib_perm_id=order.ib_perm_id,
                commission=sum((item.fill.commission for item in matching_executions), Decimal("0")),
                fills=tuple(item.fill for item in matching_executions),
                error="recovered from IBKR before retry; no duplicate order was submitted",
            )
        if matching_executions:
            filled = sum((item.fill.quantity for item in matching_executions), Decimal("0"))
            value = sum((item.fill.quantity * item.fill.price for item in matching_executions), Decimal("0"))
            first = matching_executions[0]
            return ExecutionResult(
                client_order_key=client_key, symbol=first.symbol, side=first.side,
                requested_quantity=filled, filled_quantity=filled, status="filled",
                limit_price=intent.limit_price, conid=first.conid,
                average_fill_price=value / filled if filled else None,
                ib_order_id=first.ib_order_id, ib_perm_id=first.ib_perm_id,
                commission=sum((item.fill.commission for item in matching_executions), Decimal("0")),
                fills=tuple(item.fill for item in matching_executions),
                error="recovered from IBKR before retry; no duplicate order was submitted",
            )
        return None

    @staticmethod
    def _effective_execution_ids(exec_ids: list[str]) -> set[str]:
        latest: dict[str, tuple[int, str]] = {}
        for exec_id in exec_ids:
            family, revision = execution_identity(exec_id)
            current = latest.get(family)
            if current is None or revision > current[0]:
                latest[family] = (revision, exec_id)
        return {item[1] for item in latest.values()}

    @staticmethod
    def _normalize_side(side: str) -> str:
        return {"BOT": "BUY", "BUY": "BUY", "SLD": "SELL", "SELL": "SELL"}.get(side.upper(), side.upper())

    @staticmethod
    def _normalize_order_status(status: str) -> str:
        return {
            "PRESUBMITTED": "submitted", "SUBMITTED": "submitted", "PENDINGSUBMIT": "submitted",
            "PENDINGCANCEL": "cancel_pending", "APICANCELLED": "cancelled", "CANCELLED": "cancelled",
            "FILLED": "filled", "INACTIVE": "rejected",
        }.get(status.replace(" ", "").upper(), "submitted")

    @staticmethod
    def _execution_time(value: str) -> str:
        raw = value.strip()
        parts = raw.rsplit(" ", 1)
        if len(parts) == 2 and "/" in parts[1]:
            try:
                parsed = datetime.strptime(parts[0], "%Y%m%d %H:%M:%S")
                return parsed.replace(tzinfo=ZoneInfo(parts[1])).astimezone(timezone.utc).isoformat()
            except (ValueError, KeyError):
                pass
        for pattern in ("%Y%m%d-%H:%M:%S", "%Y%m%d %H:%M:%S"):
            try:
                parsed = datetime.strptime(raw, pattern)
                return parsed.replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                continue
        return datetime.now(timezone.utc).isoformat()

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
