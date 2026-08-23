from __future__ import annotations

import json
import sys
import tempfile
import threading
import types
import unittest
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace


def _install_fake_official_ibapi() -> None:
    if "ibapi.client" in sys.modules:
        return
    package = types.ModuleType("ibapi")
    client_module = types.ModuleType("ibapi.client")
    contract_module = types.ModuleType("ibapi.contract")
    execution_module = types.ModuleType("ibapi.execution")
    order_module = types.ModuleType("ibapi.order")
    wrapper_module = types.ModuleType("ibapi.wrapper")

    class EWrapper:
        pass

    class Contract:
        pass

    class Order:
        pass

    class ExecutionFilter:
        def __init__(self) -> None:
            self.acctCode = ""
            self.lastNDays = 0

    class EClient:
        def __init__(self, wrapper: EWrapper) -> None:
            self.wrapper = wrapper
            self.connected = False
            self.placed_orders: list[tuple[int, object, object]] = []

        def connect(self, _host: str, _port: int, _client_id: int) -> None:
            self.connected = True
            self.wrapper.nextValidId(100)
            self.wrapper.managedAccounts("DU12345")

        def isConnected(self) -> bool:  # noqa: N802
            return self.connected

        def disconnect(self) -> None:
            self.connected = False

        def run(self) -> None:
            return

        def reqPositions(self) -> None:  # noqa: N802
            self.wrapper.positionEnd()

        def reqOpenOrders(self) -> None:  # noqa: N802
            self.wrapper.openOrderEnd()

        def reqExecutions(self, request_id: int, execution_filter: object) -> None:  # noqa: N802
            self.last_execution_filter = execution_filter
            self.wrapper.execDetailsEnd(request_id)

        def reqAccountSummary(self, request_id: int, _group: str, _tags: str) -> None:  # noqa: N802
            self.wrapper.accountSummary(request_id, "DU12345", "SettledCash", "10000", "USD")
            self.wrapper.accountSummary(request_id, "DU12345", "AccountType", "INDIVIDUAL", "")
            self.wrapper.accountSummaryEnd(request_id)

        def cancelAccountSummary(self, _request_id: int) -> None:  # noqa: N802
            return

        def placeOrder(self, order_id: int, contract: object, order: object) -> None:  # noqa: N802
            self.placed_orders.append((order_id, contract, order))

        def cancelOrder(self, _order_id: int, _manual_time: str) -> None:  # noqa: N802
            return

    client_module.EClient = EClient
    contract_module.Contract = Contract
    execution_module.ExecutionFilter = ExecutionFilter
    order_module.Order = Order
    wrapper_module.EWrapper = EWrapper
    sys.modules.update({
        "ibapi": package,
        "ibapi.client": client_module,
        "ibapi.contract": contract_module,
        "ibapi.execution": execution_module,
        "ibapi.order": order_module,
        "ibapi.wrapper": wrapper_module,
    })


_install_fake_official_ibapi()

from trading_executor.control_client import ControlClient  # noqa: E402
from trading_executor.engine import BrokerSnapshot, ExecutionCancelledError  # noqa: E402
from trading_executor.ib_gateway import IbGateway  # noqa: E402
from trading_executor.instance_lock import ExecutorAlreadyRunningError, SingleInstanceLock  # noqa: E402
from trading_executor.journal import AmbiguousOrderIntentError, LocalJournal  # noqa: E402
from trading_executor.policy import OrderIntent, Quote  # noqa: E402
from trading_executor.reporter import ControlReporter  # noqa: E402
from trading_executor.engine import ExecutionFill, ExecutionResult  # noqa: E402


class _ControlHandler(BaseHTTPRequestHandler):
    accepting = False
    requests: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        type(self).requests.append({"payload": payload, "headers": dict(self.headers)})
        if not type(self).accepting:
            self.send_response(503)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"temporary outage"}')
            return
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        response = {"accepted": True}
        if payload.get("action") == "order":
            response["order_id"] = "00000000-0000-4000-8000-000000000099"
        self.wfile.write(json.dumps(response).encode("utf-8"))

    def log_message(self, _format: str, *_args: object) -> None:
        return


class TradingIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_durable_outbox_replays_order_before_fill_over_signed_http(self) -> None:
        _ControlHandler.accepting = False
        _ControlHandler.requests = []
        server = ThreadingHTTPServer(("127.0.0.1", 0), _ControlHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = ControlClient(
                f"http://127.0.0.1:{server.server_port}",
                "00000000-0000-4000-8000-000000000010",
                "integration-secret",
            )
            journal = LocalJournal(self.root / "journal.sqlite3")
            reporter = ControlReporter(client, journal)
            result = ExecutionResult(
                client_order_key="hib:00000000-0000-4000-8000-000000000001:MSFT:BUY:r1:a1",
                symbol="MSFT", side="BUY", requested_quantity=Decimal("1"),
                filled_quantity=Decimal("1"), status="filled", limit_price=Decimal("100"),
                ib_order_id=42, ib_perm_id=84,
            )
            fill = ExecutionFill("0001.01", Decimal("1"), Decimal("99.5"))
            self.assertIsNone(reporter.order("00000000-0000-4000-8000-000000000001", result))
            reporter.fill(None, result, fill)
            self.assertEqual(journal.pending_count(), 2)

            _ControlHandler.accepting = True
            self.assertEqual(reporter.flush(), 2)
            self.assertEqual(journal.pending_count(), 0)
            delivered = [row["payload"] for row in _ControlHandler.requests if row["payload"].get("action") in {"order", "fill"}]
            self.assertEqual([row["action"] for row in delivered[-2:]], ["order", "fill"])
            self.assertEqual(delivered[-1]["client_order_key"], result.client_order_key)
            headers = _ControlHandler.requests[-1]["headers"]
            self.assertIn("X-Trading-Signature", headers)
            self.assertIn("X-Trading-Nonce", headers)
            journal.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_gateway_accepts_new_error_shape_and_recovers_latest_execution_correction(self) -> None:
        journal_path = self.root / "journal.sqlite3"
        journal = LocalJournal(journal_path)
        gateway = IbGateway(
            host="127.0.0.1", port=4002, client_id=71,
            expected_account="DU12345", journal=journal,
        )
        gateway.error(17, 1_724_000_000, 201, "order rejected", "{}")
        self.assertEqual(gateway._errors[17], ["201: order rejected ({})"])

        contract = SimpleNamespace(symbol="MSFT", conId=123)
        base = {
            "orderId": 42, "permId": 84,
            "orderRef": "hib:00000000-0000-4000-8000-000000000001:MSFT:BUY:r1:a1",
            "side": "BOT", "time": "20260824 10:01:00 America/New_York",
        }
        gateway.execDetails(1, contract, SimpleNamespace(execId="0001.01", shares="1", price="100", **base))
        gateway.execDetails(1, contract, SimpleNamespace(execId="0001.02", shares="0.5", price="99", **base))
        gateway.commissionReport(SimpleNamespace(execId="0001.02", commission="0.25", currency="USD"))
        journal.close()

        restored_journal = LocalJournal(journal_path)
        restored = IbGateway(
            host="127.0.0.1", port=4002, client_id=71,
            expected_account="DU12345", journal=restored_journal,
        )
        snapshot = restored.reconcile()
        self.assertEqual(len(snapshot.executions), 1)
        self.assertEqual(snapshot.executions[0].fill.exec_id, "0001.02")
        self.assertEqual(snapshot.executions[0].fill.quantity, Decimal("0.5"))
        self.assertEqual(snapshot.executions[0].fill.commission, Decimal("0.25"))
        self.assertEqual(restored.last_execution_filter.lastNDays, 7)
        restored_journal.close()

    def test_ambiguous_prepared_order_is_never_resubmitted(self) -> None:
        journal = LocalJournal(self.root / "journal.sqlite3")
        plan_id = "00000000-0000-4000-8000-000000000001"
        client_key = f"hib:{plan_id}:MSFT:BUY:r1:a1"
        journal.prepare_order(client_key, {"symbol": "MSFT"}, 100)
        gateway = IbGateway(
            host="127.0.0.1", port=4002, client_id=71,
            expected_account="DU12345", journal=journal,
        )
        gateway.reconcile = lambda: BrokerSnapshot("DU12345", [], Decimal("1000"))  # type: ignore[method-assign]
        gateway.fresh_quotes = lambda _symbols: {  # type: ignore[method-assign]
            "MSFT": Quote("MSFT", Decimal("99"), Decimal("100"), 1)
        }
        gateway.what_if = lambda _intents: []  # type: ignore[method-assign]
        gateway._next_order_id = 100
        intent = OrderIntent("MSFT", 123, "BUY", Decimal("1"), Decimal("101"), Decimal("0.01"))
        with self.assertRaises(AmbiguousOrderIntentError):
            gateway._execute_one(plan_id, intent, 1, 3)
        self.assertEqual(gateway.placed_orders, [])
        journal.close()

    def test_retry_quote_can_never_worsen_the_preflight_limit(self) -> None:
        journal = LocalJournal(self.root / "journal.sqlite3")
        plan_id = "00000000-0000-4000-8000-000000000001"
        gateway = IbGateway(
            host="127.0.0.1", port=4002, client_id=71,
            expected_account="DU12345", journal=journal,
        )
        gateway.reconcile = lambda: BrokerSnapshot("DU12345", [], Decimal("1000"))  # type: ignore[method-assign]
        gateway.fresh_quotes = lambda _symbols: {  # type: ignore[method-assign]
            "MSFT": Quote("MSFT", Decimal("109"), Decimal("110"), 1)
        }
        gateway.what_if = lambda _intents: []  # type: ignore[method-assign]
        gateway._next_order_id = 100

        placed_limits: list[float] = []

        def place_and_fill(order_id: int, contract: object, order: object) -> None:
            gateway.placed_orders.append((order_id, contract, order))
            placed_limits.append(float(order.lmtPrice))
            gateway.orderStatus(order_id, "Filled", Decimal("1"), Decimal("0"), 101, 84, 0, 101, 71, "", 0)
            execution = SimpleNamespace(
                execId="0002.01", orderId=order_id, permId=84, orderRef=order.orderRef,
                side="BOT", shares="1", price="101", time="20260824 10:01:00 America/New_York",
            )
            gateway.execDetails(1, SimpleNamespace(symbol="MSFT", conId=123), execution)
            gateway.commissionReport(SimpleNamespace(execId="0002.01", commission="0.25", currency="USD"))

        gateway.placeOrder = place_and_fill  # type: ignore[method-assign]
        intent = OrderIntent("MSFT", 123, "BUY", Decimal("1"), Decimal("101"), Decimal("0.01"))
        results = gateway._execute_one(plan_id, intent, 1, 3)
        self.assertEqual(placed_limits, [101.0])
        self.assertEqual(results[0].status, "filled")
        journal.close()

    def test_remote_kill_switch_guard_stops_before_order_submission(self) -> None:
        journal = LocalJournal(self.root / "journal.sqlite3")
        plan_id = "00000000-0000-4000-8000-000000000001"

        def cancelled(_plan_id: str) -> None:
            raise ExecutionCancelledError("kill switch")

        gateway = IbGateway(
            host="127.0.0.1", port=4002, client_id=71,
            expected_account="DU12345", journal=journal, submission_guard=cancelled,
        )
        gateway.reconcile = lambda: BrokerSnapshot("DU12345", [], Decimal("1000"))  # type: ignore[method-assign]
        gateway._next_order_id = 100
        intent = OrderIntent("MSFT", 123, "BUY", Decimal("1"), Decimal("101"), Decimal("0.01"))
        with self.assertRaises(ExecutionCancelledError):
            gateway._execute_one(plan_id, intent, 1, 3)
        self.assertEqual(gateway.placed_orders, [])
        self.assertEqual(journal.unresolved_order_keys(), set())
        journal.close()

    def test_local_single_instance_lock_rejects_a_second_executor(self) -> None:
        lock_path = self.root / "executor.lock"
        with SingleInstanceLock(lock_path):
            with self.assertRaises(ExecutorAlreadyRunningError):
                with SingleInstanceLock(lock_path):
                    pass


if __name__ == "__main__":
    unittest.main()
