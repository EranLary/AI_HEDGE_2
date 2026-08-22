from __future__ import annotations

import unittest
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from trading_executor.engine import BrokerSnapshot, ExecutionEngine, ExecutionFill, ExecutionResult
from trading_executor.policy import Instrument, OrderIntent, Position, Quote


class FakeBroker:
    def __init__(self) -> None:
        self.positions = [Position("AAPL", Decimal("5"))]
        self.instruments = {
            symbol: Instrument(symbol, index + 1, "USD", "NASDAQ", Decimal("0.01"), Decimal("1"), False, True)
            for index, symbol in enumerate(["AAPL", "MSFT"])
        }
        self.quotes = {
            "AAPL": Quote("AAPL", Decimal("99"), Decimal("100"), 1),
            "MSFT": Quote("MSFT", Decimal("99"), Decimal("100"), 1),
        }
        self.what_if_errors: list[str] = []
        self.phases: list[str] = []
        self.partial_side = ""
        self.cancelled: list[str] = []
        self.settled_cash = Decimal("1000")
        self.account_type = "INDIVIDUAL"

    def reconcile(self) -> BrokerSnapshot:
        return BrokerSnapshot(
            account_id="DU12345", positions=list(self.positions), settled_cash_usd=self.settled_cash,
            account_type=self.account_type,
        )

    def resolve_instruments(self, symbols: list[str]) -> dict[str, Instrument]:
        return {symbol: self.instruments[symbol] for symbol in symbols}

    def fresh_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        return {symbol: self.quotes[symbol] for symbol in symbols}

    def what_if(self, intents: list[OrderIntent]) -> list[str]:
        return self.what_if_errors

    def execute_phase(self, plan_id: str, intents: list[OrderIntent], *, revision: int, max_attempts: int) -> list[ExecutionResult]:
        self.phases.append(intents[0].side)
        results: list[ExecutionResult] = []
        current = {position.symbol: position.quantity for position in self.positions}
        for index, intent in enumerate(intents):
            fill = intent.quantity / 2 if self.partial_side == intent.side else intent.quantity
            current[intent.symbol] = current.get(intent.symbol, Decimal("0")) + (fill if intent.side == "BUY" else -fill)
            execution_fill = ExecutionFill(
                exec_id=f"exec-{intent.side.lower()}-{revision}-{index}", quantity=fill, price=intent.limit_price,
                commission=Decimal("0.25"), executed_at="2026-08-24T14:05:00+00:00",
            )
            results.append(ExecutionResult(
                client_order_key=f"key-{revision}-{index}", symbol=intent.symbol, side=intent.side,
                requested_quantity=intent.quantity, filled_quantity=fill,
                status="filled" if fill == intent.quantity else "partially_filled",
                limit_price=intent.limit_price, average_fill_price=intent.limit_price,
                commission=Decimal("0.25"), fills=(execution_fill,),
            ))
        self.positions = [Position(symbol, quantity) for symbol, quantity in current.items() if quantity > 0]
        return results

    def cancel_plan_orders(self, plan_id: str) -> None:
        self.cancelled.append(plan_id)


class FakeReporter:
    def __init__(self) -> None:
        self.statuses: list[str] = []
        self.orders: list[ExecutionResult] = []
        self.position_updates: list[list[Position]] = []
        self.alerts: list[str] = []
        self.fills: list[ExecutionFill] = []
        self.preflights: list[dict] = []

    def plan_status(self, plan_id: str, status: str, *, error: str = "", preflight: dict | None = None) -> None:
        self.statuses.append(status)
        self.preflights.append(preflight or {})

    def order(self, plan_id: str, result: ExecutionResult) -> str:
        self.orders.append(result)
        return "order-id"

    def fill(self, order_id: str | None, result: ExecutionResult, fill: ExecutionFill) -> None:
        self.fills.append(fill)

    def positions(self, strategy_link_id: str, positions: list[Position]) -> None:
        self.position_updates.append(positions)

    def instrument(self, instrument: Instrument) -> None:
        pass

    def alert(self, event_type: str, severity: str, message: str, payload: dict | None = None) -> None:
        self.alerts.append(event_type)


def command(status: str = "queued") -> dict:
    return {
        "plan_id": "00000000-0000-4000-8000-000000000001",
        "strategy_link_id": "00000000-0000-4000-8000-000000000002",
        "status": status,
        "mode": "paper",
        "budget_usd": 1000,
        "command_revision": 1,
        "target_holdings": [{"ticker": "MSFT", "weight": 1}],
        "owned_positions": [{"symbol": "AAPL", "quantity": 5}],
    }


class EngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.broker = FakeBroker()
        self.reporter = FakeReporter()
        self.engine = ExecutionEngine(self.broker, self.reporter, account_id="DU12345", execution_enabled=True)
        self.now = datetime(2026, 8, 24, 10, 5, tzinfo=ZoneInfo("America/New_York"))

    def test_sells_finish_before_buys(self) -> None:
        self.engine.handle(command(), now=self.now)
        self.assertEqual(self.broker.phases, ["SELL", "BUY"])
        self.assertEqual(self.reporter.statuses[-1], "completed")
        self.assertEqual(len(self.reporter.fills), 2)
        self.assertEqual({fill.exec_id for fill in self.reporter.fills}, {"exec-sell-1-0", "exec-buy-1-0"})

    def test_sale_proceeds_are_not_used_until_ibkr_reports_settled_cash(self) -> None:
        self.broker.settled_cash = Decimal("0")
        self.engine.handle(command(), now=self.now)
        self.assertEqual(self.broker.phases, ["SELL"])
        self.assertEqual(self.reporter.statuses[-1], "awaiting_settlement")
        self.assertEqual(self.reporter.preflights[-1]["same_day_sale_proceeds_counted"], False)

    def test_buy_only_plan_cannot_borrow_on_margin(self) -> None:
        self.broker.positions = []
        self.broker.settled_cash = Decimal("100")
        buy_only = command()
        buy_only["owned_positions"] = []
        self.engine.handle(buy_only, now=self.now)
        self.assertEqual(self.broker.phases, [])
        self.assertEqual(self.reporter.statuses[-1], "blocked")
        self.assertIn("balance_anomaly", self.reporter.alerts)

    def test_restart_after_reported_sell_waits_instead_of_blocking_or_reordering(self) -> None:
        self.broker.positions = []
        self.broker.settled_cash = Decimal("0")
        recovered = command("selling")
        recovered["owned_positions"] = []
        recovered["existing_orders"] = [{"side": "SELL", "filled_quantity": 5}]
        self.engine.handle(recovered, now=self.now)
        self.assertEqual(self.broker.phases, [])
        self.assertEqual(self.reporter.statuses[-1], "awaiting_settlement")

    def test_zero_quantity_target_reports_n_over_n_and_minimum_budget(self) -> None:
        self.broker.positions = []
        self.broker.quotes["MSFT"] = Quote("MSFT", Decimal("499"), Decimal("500"), 1)
        too_small = command()
        too_small["owned_positions"] = []
        too_small["budget_usd"] = 300
        self.engine.handle(too_small, now=self.now)
        self.assertEqual(self.broker.phases, [])
        self.assertEqual(self.reporter.statuses[-1], "blocked")
        self.assertEqual(self.reporter.preflights[-1]["target_coverage"], "0/1")
        self.assertGreater(Decimal(self.reporter.preflights[-1]["minimum_budget_usd"]), Decimal("500"))

    def test_what_if_failure_is_atomic(self) -> None:
        self.broker.what_if_errors = ["insufficient permissions"]
        self.engine.handle(command(), now=self.now)
        self.assertEqual(self.broker.phases, [])
        self.assertEqual(self.reporter.statuses[-1], "blocked")

    def test_partial_sell_prevents_buys_and_updates_ownership(self) -> None:
        self.broker.partial_side = "SELL"
        self.engine.handle(command(), now=self.now)
        self.assertEqual(self.broker.phases, ["SELL"])
        self.assertEqual(self.reporter.statuses[-1], "partial")
        self.assertTrue(self.reporter.position_updates)

    def test_stale_quote_blocks_all_orders(self) -> None:
        self.broker.quotes["MSFT"] = Quote("MSFT", Decimal("99"), Decimal("100"), 30)
        self.engine.handle(command(), now=self.now)
        self.assertEqual(self.broker.phases, [])
        self.assertEqual(self.reporter.statuses[-1], "blocked")

    def test_cancel_request_only_cancels_system_orders(self) -> None:
        self.engine.handle(command("cancel_requested"), now=self.now)
        self.assertEqual(self.broker.cancelled, [command()["plan_id"]])
        self.assertEqual(self.reporter.statuses, ["cancelled"])


if __name__ == "__main__":
    unittest.main()
