from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any

from .control_client import ControlClient
from .engine import ExecutionResult
from .policy import Instrument, Position


class ControlReporter:
    def __init__(self, client: ControlClient) -> None:
        self.client = client

    def plan_status(self, plan_id: str, status: str, *, error: str = "", preflight: dict[str, Any] | None = None) -> None:
        self.client.event({"action": "plan_status", "plan_id": plan_id, "status": status, "error": error, "preflight": preflight or {}})

    def order(self, plan_id: str, result: ExecutionResult) -> str | None:
        response = self.client.event({
            "action": "order", "plan_id": plan_id, "client_order_key": result.client_order_key,
            "symbol": result.symbol, "side": result.side,
            "requested_quantity": str(result.requested_quantity), "filled_quantity": str(result.filled_quantity),
            "limit_price": str(result.limit_price),
            "average_fill_price": str(result.average_fill_price) if result.average_fill_price is not None else None,
            "ib_order_id": result.ib_order_id, "ib_perm_id": result.ib_perm_id,
            "status": result.status, "commission": str(result.commission), "commission_currency": "USD",
            "raw_status": {"error": result.error},
        })
        return str(response.get("order_id")) if response.get("order_id") else None

    def fill(self, order_id: str | None, result: ExecutionResult) -> None:
        self.client.event({
            "action": "fill", "order_id": order_id, "exec_id": result.exec_id,
            "symbol": result.symbol, "side": result.side, "quantity": str(result.filled_quantity),
            "price": str(result.average_fill_price), "commission": str(result.commission),
            "commission_currency": "USD", "executed_at": datetime.now(timezone.utc).isoformat(),
        })

    def positions(self, strategy_link_id: str, positions: list[Position]) -> None:
        self.client.event({
            "action": "positions", "strategy_link_id": strategy_link_id,
            "positions": [{"symbol": item.symbol, "quantity": str(item.quantity)} for item in positions],
        })

    def instrument(self, instrument: Instrument) -> None:
        self.client.event({
            "action": "instrument", "symbol": instrument.symbol, "conid": instrument.conid,
            "sec_type": "STK", "exchange": instrument.exchange,
            "primary_exchange": instrument.primary_exchange, "currency": instrument.currency,
            "min_tick": str(instrument.min_tick), "min_size": str(instrument.min_size),
            "size_increment": str(instrument.size_increment),
            "supports_fractional": instrument.supports_fractional,
            "liquid_hours": instrument.liquid_hours, "time_zone": instrument.time_zone,
            "approved": instrument.approved,
        })

    def alert(self, event_type: str, severity: str, message: str, payload: dict[str, Any] | None = None) -> None:
        digest = hashlib.sha256(message.encode("utf-8")).hexdigest()[:12]
        event_id = f"{event_type}:{datetime.now(timezone.utc).strftime('%Y%m%d%H%M')}:{digest}"
        self.client.event({
            "action": "event", "event_id": event_id, "event_type": event_type,
            "severity": severity, "message": message, "payload": payload or {},
        })
