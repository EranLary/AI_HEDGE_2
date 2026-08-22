from __future__ import annotations

import unittest
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from trading_executor.engine import in_execution_window, instrument_session_is_open
from trading_executor.policy import (
    Instrument,
    Position,
    Quote,
    Target,
    build_order_intents,
    calculate_sizing_coverage,
    InsufficientTargetCoverageError,
    investable_budget,
    validate_position_ownership,
)


class PolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.instrument = Instrument("AAPL", 265598, "USD", "NASDAQ", Decimal("0.01"), Decimal("1"), False, True)
        self.quote = Quote("AAPL", Decimal("99.90"), Decimal("100.00"), 1)

    def test_budget_keeps_two_percent_reserve(self) -> None:
        self.assertEqual(investable_budget(Decimal("1000")), Decimal("980.00"))

    def test_integer_sizing_never_exceeds_investable_budget(self) -> None:
        sells, buys = build_order_intents(
            budget_usd=Decimal("1000"), targets=[Target("AAPL", Decimal("1"))],
            owned_positions=[], quotes={"AAPL": self.quote}, instruments={"AAPL": self.instrument},
        )
        self.assertEqual(sells, [])
        self.assertEqual(buys[0].quantity, Decimal("9"))
        self.assertLessEqual(buys[0].quantity * buys[0].limit_price, Decimal("980"))

    def test_fractional_sizing_includes_marketable_limit_cushion(self) -> None:
        fractional = Instrument("AAPL", 265598, "USD", "NASDAQ", Decimal("0.01"), Decimal("0.001"), True, True)
        _, buys = build_order_intents(
            budget_usd=Decimal("1000"), targets=[Target("AAPL", Decimal("1"))],
            owned_positions=[], quotes={"AAPL": self.quote}, instruments={"AAPL": fractional},
        )
        self.assertLessEqual(buys[0].quantity * buys[0].limit_price, Decimal("980"))

    def test_natural_portfolio_smaller_than_twenty_requires_its_own_n_over_n_coverage(self) -> None:
        instruments = {
            symbol: Instrument(symbol, index, "USD", "NASDAQ", Decimal("0.01"), Decimal("1"), False, True)
            for index, symbol in enumerate(["AAPL", "MSFT"], start=1)
        }
        quotes = {symbol: Quote(symbol, Decimal("99.90"), Decimal("100"), 1) for symbol in instruments}
        coverage = calculate_sizing_coverage(
            budget_usd=Decimal("1000"),
            targets=[Target("AAPL", Decimal("0.5")), Target("MSFT", Decimal("0.5"))],
            quotes=quotes, instruments=instruments,
        )
        self.assertEqual((coverage.covered_target_count, coverage.target_count), (2, 2))
        self.assertTrue(coverage.complete)

    def test_budget_that_drops_one_target_blocks_the_entire_rebalance(self) -> None:
        expensive = Instrument("MSFT", 2, "USD", "NASDAQ", Decimal("0.01"), Decimal("1"), False, True)
        targets = [Target("AAPL", Decimal("0.5")), Target("MSFT", Decimal("0.5"))]
        quotes = {"AAPL": self.quote, "MSFT": Quote("MSFT", Decimal("499.9"), Decimal("500"), 1)}
        instruments = {"AAPL": self.instrument, "MSFT": expensive}
        with self.assertRaises(InsufficientTargetCoverageError) as raised:
            build_order_intents(
                budget_usd=Decimal("300"), targets=targets, owned_positions=[],
                quotes=quotes, instruments=instruments,
            )
        self.assertEqual(raised.exception.coverage.target_count, 2)
        self.assertEqual(raised.exception.coverage.covered_target_count, 1)
        self.assertEqual(raised.exception.coverage.uncovered_symbols, ("MSFT",))
        self.assertGreater(raised.exception.coverage.minimum_budget_usd, Decimal("1000"))

    def test_empty_target_cannot_liquidate(self) -> None:
        with self.assertRaisesRegex(ValueError, "explicit liquidation"):
            build_order_intents(
                budget_usd=Decimal("1000"), targets=[],
                owned_positions=[Position("AAPL", Decimal("2"))],
                quotes={"AAPL": self.quote}, instruments={"AAPL": self.instrument},
            )

    def test_manual_overlap_is_blocking(self) -> None:
        conflicts = validate_position_ownership(
            [Position("AAPL", Decimal("12"))], [Position("AAPL", Decimal("10"))], ["AAPL"],
        )
        self.assertEqual(conflicts, ["AAPL"])

    def test_unrelated_manual_position_is_not_owned(self) -> None:
        conflicts = validate_position_ownership(
            [Position("MSFT", Decimal("4"))], [], ["AAPL"],
        )
        self.assertEqual(conflicts, [])

    def test_execution_window_is_new_york_regular_hours_only(self) -> None:
        zone = ZoneInfo("America/New_York")
        self.assertTrue(in_execution_window(datetime(2026, 8, 24, 10, 0, tzinfo=zone)))
        self.assertFalse(in_execution_window(datetime(2026, 8, 24, 9, 59, tzinfo=zone)))
        self.assertFalse(in_execution_window(datetime(2026, 8, 23, 11, 0, tzinfo=zone)))

    def test_contract_liquid_hours_block_a_closed_session(self) -> None:
        zone = ZoneInfo("America/New_York")
        open_instrument = Instrument(
            "AAPL", 1, "USD", "NASDAQ", Decimal("0.01"), Decimal("1"), False, True,
            liquid_hours="20260824:0930-20260824:1600", time_zone="US/Eastern",
        )
        self.assertTrue(instrument_session_is_open(open_instrument, datetime(2026, 8, 24, 10, 0, tzinfo=zone)))
        self.assertFalse(instrument_session_is_open(open_instrument, datetime(2026, 8, 24, 17, 0, tzinfo=zone)))


if __name__ == "__main__":
    unittest.main()
