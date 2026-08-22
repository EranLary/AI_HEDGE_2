from __future__ import annotations

import unittest
from decimal import Decimal

from trading_executor.engine import BrokerExecution, BrokerSnapshot, ExecutionFill
from trading_executor.reporter import ControlReporter


class FakeClient:
    def __init__(self) -> None:
        self.events: list[dict] = []

    def event(self, payload: dict) -> dict:
        self.events.append(payload)
        if payload["action"] == "order":
            return {"order_id": "00000000-0000-4000-8000-000000000099"}
        return {"accepted": True}


class ReporterRecoveryTests(unittest.TestCase):
    def test_broker_first_recovery_reports_each_exec_id_before_retry(self) -> None:
        plan_id = "00000000-0000-4000-8000-000000000001"
        client_key = f"hib:{plan_id}:MSFT:BUY:r1:a1"
        snapshot = BrokerSnapshot(
            account_id="DU12345", positions=[], settled_cash_usd=Decimal("100"),
            executions=(
                BrokerExecution(
                    client_order_key=client_key, symbol="MSFT", side="BUY", conid=1,
                    ib_order_id=42, ib_perm_id=84,
                    fill=ExecutionFill("exec-a", Decimal("0.4"), Decimal("100"), Decimal("0.10"), executed_at="2026-08-24T14:00:00+00:00"),
                ),
                BrokerExecution(
                    client_order_key=client_key, symbol="MSFT", side="BUY", conid=1,
                    ib_order_id=42, ib_perm_id=84,
                    fill=ExecutionFill("exec-b", Decimal("0.6"), Decimal("101"), Decimal("0.15"), executed_at="2026-08-24T14:00:01+00:00"),
                ),
            ),
        )
        client = FakeClient()
        recovered = ControlReporter(client).recover(snapshot)
        self.assertEqual(recovered, 1)
        self.assertEqual([event["action"] for event in client.events], ["order", "fill", "fill"])
        self.assertEqual([event["exec_id"] for event in client.events[1:]], ["exec-a", "exec-b"])
        self.assertTrue(client.events[0]["raw_status"]["recovered"])


if __name__ == "__main__":
    unittest.main()
