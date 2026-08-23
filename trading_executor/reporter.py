from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
from typing import Any
from uuid import UUID

from .control_client import ControlClient, ControlPlaneError
from .engine import BrokerSnapshot, ExecutionFill, ExecutionResult
from .journal import LocalJournal, execution_identity
from .policy import Instrument


class ControlReporter:
    def __init__(self, client: ControlClient, journal: LocalJournal | None = None) -> None:
        self.client = client
        self.journal = journal

    def _send(self, payload: dict[str, Any], *, strict: bool) -> dict[str, Any] | None:
        if self.journal:
            return self.journal.send(self.client, payload, strict=strict)
        return self.client.event(payload)

    def flush(self) -> int:
        return self.journal.flush(self.client) if self.journal else 0

    def plan_status(self, plan_id: str, status: str, *, error: str = "", preflight: dict[str, Any] | None = None) -> None:
        response = self._send({"action": "plan_status", "plan_id": plan_id, "status": status, "error": error, "preflight": preflight or {}}, strict=True)
        if not response or response.get("accepted") is not True:
            raise ControlPlaneError(f"control plane rejected plan status {status} for {plan_id}")

    def order(self, plan_id: str, result: ExecutionResult) -> str | None:
        response = self._send({
            "action": "order", "plan_id": plan_id, "client_order_key": result.client_order_key,
            "symbol": result.symbol, "side": result.side,
            "requested_quantity": str(result.requested_quantity), "filled_quantity": str(result.filled_quantity),
            "limit_price": str(result.limit_price),
            "average_fill_price": str(result.average_fill_price) if result.average_fill_price is not None else None,
            "conid": result.conid,
            "ib_order_id": result.ib_order_id, "ib_perm_id": result.ib_perm_id,
            "status": result.status, "commission": str(result.commission),
            "commission_currency": result.commission_currency,
            "raw_status": {"error": result.error, "recovered": result.recovered},
        }, strict=False) or {}
        return str(response.get("order_id")) if response.get("order_id") else None

    def fill(self, order_id: str | None, result: ExecutionResult, fill: ExecutionFill) -> None:
        self._send({
            "action": "fill", "order_id": order_id,
            "client_order_key": result.client_order_key, "exec_id": fill.exec_id,
            "symbol": result.symbol, "side": result.side, "quantity": str(fill.quantity),
            "price": str(fill.price), "commission": str(fill.commission),
            "commission_currency": fill.commission_currency,
            "executed_at": fill.executed_at or datetime.now(timezone.utc).isoformat(),
            "raw_execution": fill.raw_execution or {},
        }, strict=False)

    def recover(self, snapshot: BrokerSnapshot) -> int:
        system_orders = {order.client_order_key: order for order in snapshot.open_orders if order.client_order_key.startswith("hib:")}
        executions_by_key: dict[str, list] = {}
        for execution in snapshot.executions:
            if execution.client_order_key.startswith("hib:"):
                executions_by_key.setdefault(execution.client_order_key, []).append(execution)
        recovered = 0
        for client_key in sorted(set(system_orders) | set(executions_by_key)):
            plan_id = self._plan_id(client_key)
            if not plan_id:
                continue
            broker_order = system_orders.get(client_key)
            executions = self._effective_executions(executions_by_key.get(client_key, []))
            fills = tuple(item.fill for item in executions)
            fill_quantity = sum((fill.quantity for fill in fills), start=Decimal("0"))
            if broker_order:
                filled_quantity = fill_quantity if fills else broker_order.filled_quantity
                status = broker_order.status
                if filled_quantity > 0 and status == "submitted":
                    status = "partially_filled"
                result = ExecutionResult(
                    client_order_key=client_key, symbol=broker_order.symbol, side=broker_order.side,
                    requested_quantity=broker_order.requested_quantity,
                    filled_quantity=filled_quantity, status=status,
                    limit_price=broker_order.limit_price, average_fill_price=broker_order.average_fill_price,
                    conid=broker_order.conid, ib_order_id=broker_order.ib_order_id,
                    ib_perm_id=broker_order.ib_perm_id,
                    commission=sum((fill.commission for fill in fills), start=Decimal("0")), fills=fills,
                    recovered=True, error="recovered from IBKR reconciliation",
                )
            elif executions:
                value = sum((fill.quantity * fill.price for fill in fills), start=Decimal("0"))
                first = executions[0]
                result = ExecutionResult(
                    client_order_key=client_key, symbol=first.symbol, side=first.side,
                    requested_quantity=fill_quantity, filled_quantity=fill_quantity, status="filled",
                    limit_price=value / fill_quantity if fill_quantity else Decimal("0"),
                    average_fill_price=value / fill_quantity if fill_quantity else None,
                    conid=first.conid, ib_order_id=first.ib_order_id, ib_perm_id=first.ib_perm_id,
                    commission=sum((fill.commission for fill in fills), start=Decimal("0")), fills=fills,
                    recovered=True, error="recovered from IBKR reconciliation",
                )
            else:
                continue
            order_id = self.order(plan_id, result)
            for fill in fills:
                self.fill(order_id, result, fill)
            recovered += 1
        return recovered

    @staticmethod
    def _effective_executions(executions: list) -> list:
        latest: dict[str, tuple[int, Any]] = {}
        for execution in executions:
            family, revision = execution_identity(execution.fill.exec_id)
            current = latest.get(family)
            if current is None or revision > current[0]:
                latest[family] = (revision, execution)
        return [item[1] for item in latest.values()]

    @staticmethod
    def _plan_id(client_order_key: str) -> str | None:
        parts = client_order_key.split(":", 2)
        if len(parts) < 3 or parts[0] != "hib":
            return None
        try:
            return str(UUID(parts[1]))
        except ValueError:
            return None

    def instrument(self, instrument: Instrument) -> None:
        response = self._send({
            "action": "instrument", "symbol": instrument.symbol, "conid": instrument.conid,
            "sec_type": "STK", "exchange": instrument.exchange,
            "primary_exchange": instrument.primary_exchange, "currency": instrument.currency,
            "min_tick": str(instrument.min_tick), "min_size": str(instrument.min_size),
            "size_increment": str(instrument.size_increment),
            "supports_fractional": instrument.supports_fractional,
            "liquid_hours": instrument.liquid_hours, "time_zone": instrument.time_zone,
            "approved": instrument.approved,
        }, strict=True)
        if not response or response.get("accepted") is not True:
            raise ControlPlaneError(f"control plane rejected instrument {instrument.symbol}")

    def alert(self, event_type: str, severity: str, message: str, payload: dict[str, Any] | None = None) -> None:
        digest = hashlib.sha256(message.encode("utf-8")).hexdigest()[:12]
        event_id = f"{event_type}:{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}:{digest}"
        self._send({
            "action": "event", "event_id": event_id, "event_type": event_type,
            "severity": severity, "message": message, "payload": payload or {},
        }, strict=False)
