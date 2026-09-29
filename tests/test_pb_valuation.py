from __future__ import annotations

import json
import math

import pytest

from ai_hedge import legacy_port as lp


@pytest.mark.parametrize(
    "sector",
    [
        "Financial Services",
        "Real Estate",
        "Utilities",
        "Industrials",
        "Basic Materials",
        "  financial   services  ",
        "REAL ESTATE",
    ],
)
def test_pb_sector_gate_accepts_only_configured_yahoo_sectors(sector: str) -> None:
    assert lp.pb_valuation_sector({"info": {"sector": sector}}) == sector.strip()


@pytest.mark.parametrize("sector", [None, "", "Technology", "Healthcare", "Financial"])
def test_pb_sector_gate_rejects_missing_or_other_sectors(sector: str | None) -> None:
    assert lp.pb_valuation_sector({"info": {"sector": sector}}) is None


def _valid_pb_payload() -> dict:
    return {
        "step_by_step_analysis": "[REPORTED FACT] Equity was 400. [ANALYST ESTIMATE] Normalize it to 450.",
        "representative_book_equity": 450.0,
        "representative_book_equity_rationale": "[CALCULATION] 400 reported plus 50 supported adjustment equals 450.",
        "pb_multiple": 1.6,
        "pb_multiple_rationale": "[ANALYST ESTIMATE] Durable ROE and risk support 1.6 times book.",
        "investment_amount": 12_500,
        "investment_rationale": "Upside and balance-sheet resilience support a 12.5% long position.",
    }


def test_extract_pb_valuation_json_accepts_strict_valid_payload() -> None:
    parsed = lp.extract_pb_valuation_json(json.dumps(_valid_pb_payload()))

    assert parsed["representative_book_equity"] == 450.0
    assert parsed["pb_multiple"] == 1.6
    assert parsed["investment_amount"] == 12_500.0


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload.pop("pb_multiple"),
        lambda payload: payload.update(pb_multiple=0),
        lambda payload: payload.update(representative_book_equity=-1),
        lambda payload: payload.update(investment_amount=100_001),
        lambda payload: payload.update(pb_multiple=math.inf),
        lambda payload: payload.update(pb_multiple_rationale=""),
        lambda payload: payload.update(target_market_cap=720),
    ],
)
def test_extract_pb_valuation_json_rejects_invalid_or_extra_fields(mutate) -> None:
    payload = _valid_pb_payload()
    mutate(payload)

    assert lp.extract_pb_valuation_json(json.dumps(payload)) == {}


def test_extract_pb_valuation_json_rejects_malformed_json() -> None:
    assert lp.extract_pb_valuation_json('{"representative_book_equity":') == {}


def test_calculate_pb_valuation_derives_market_cap_and_price_from_verified_shares() -> None:
    result = lp.calculate_pb_valuation(
        {"shares_outstanding": 12.0},
        representative_book_equity=450.0,
        pb_multiple=1.6,
    )

    assert result["target_market_cap"] == pytest.approx(720.0)
    assert result["target_price"] == pytest.approx(60.0)


def _patch_standard_valuation_families(monkeypatch, *, target: float = 100.0) -> None:
    detail = lambda: [{"target_price": target, "investment_amount": 10_000, "raw_json": {"target_market_cap": 1_000}}]
    monkeypatch.setattr(lp, "scenario_dcf_full", lambda *args, **kwargs: ([target], ("txt", "DCF"), detail()))
    monkeypatch.setattr(lp, "bbb_tp_full", lambda *args, **kwargs: ([target], ("txt", "Target"), detail()))
    monkeypatch.setattr(
        lp,
        "bbb_ni_pe_full",
        lambda *args, **kwargs: ([target], [10.0], [10.0], ("txt", "Earnings"), detail()),
    )
    monkeypatch.setattr(
        lp,
        "revenue_scenario_full",
        lambda *args, **kwargs: ([target], [2.0], [100.0], ("txt", "Revenue"), detail()),
    )
    monkeypatch.setattr(
        lp,
        "composite_scenario_full",
        lambda *args, **kwargs: ([target], [100.0], [10.0], [10.0], ("txt", "Composite"), detail()),
    )
    monkeypatch.setattr(lp, "sotp_scenario_full", lambda *args, **kwargs: ([target], ("txt", "SOTP"), detail()))
    monkeypatch.setattr(lp, "dream_valuation_full", lambda *args, **kwargs: ([target], ("txt", "Dream"), detail()))


def _variables() -> dict:
    return {
        "price_currency": 1.0,
        "financial_currency": 1.0,
        "price": 80.0,
        "revenue": 1_000.0,
        "net_income": 100.0,
        "market_cap": 800.0,
        "shares_outstanding": 10.0,
        "ev": 900.0,
    }


def test_run_valuations_skips_pb_without_eligible_yahoo_sector(monkeypatch) -> None:
    _patch_standard_valuation_families(monkeypatch)
    monkeypatch.setattr(
        lp,
        "pb_valuation_full",
        lambda *args, **kwargs: pytest.fail("P/B must not be called for an ineligible sector"),
    )
    explain = {}

    result = lp.run_valuations(
        ticker="TEST",
        info_dict={"short_name": "Test Co", "info": {"sector": "Technology"}},
        financial_dict={},
        variables_dict=_variables(),
        text="x",
        add_text=False,
        explain_collector=explain,
    )

    assert lp.PB_VALUATION_METHOD_NAME not in explain["methods"]
    assert result["Prices"]["Mean"][0] == pytest.approx(100.0)


def test_run_valuations_gives_successful_pb_one_equal_family_vote(monkeypatch) -> None:
    _patch_standard_valuation_families(monkeypatch)
    pb_details = [
        {
            "target_price": 200.0,
            "investment_amount": 20_000,
            "raw_json": {
                "representative_book_equity": 1_000.0,
                "pb_multiple": 2.0,
                "target_market_cap": 2_000.0,
            },
        }
    ]
    monkeypatch.setattr(
        lp,
        "pb_valuation_full",
        lambda *args, **kwargs: ([200.0], ("txt", lp.PB_VALUATION_METHOD_NAME), pb_details),
    )
    explain = {}

    result = lp.run_valuations(
        ticker="TEST",
        info_dict={"short_name": "Test Co", "info": {"sector": "Financial Services"}},
        financial_dict={},
        variables_dict=_variables(),
        text="x",
        add_text=False,
        explain_collector=explain,
    )

    assert result["Prices"]["Mean"][0] == pytest.approx(112.5)
    assert result["Prices"]["Median"][0] == pytest.approx(100.0)
    assert explain["aggregate_targets"][lp.PB_VALUATION_METHOD_NAME] == 200.0
    assert explain["aggregate_investments"][lp.PB_VALUATION_METHOD_NAME] == 20_000.0


def test_run_valuations_omits_pb_after_retry_failure_without_failing_report(monkeypatch) -> None:
    _patch_standard_valuation_families(monkeypatch)
    calls = 0

    def failed_pb(*args, **kwargs):
        nonlocal calls
        calls += 1
        return [], ("no results", lp.PB_VALUATION_METHOD_NAME), []

    monkeypatch.setattr(lp, "pb_valuation_full", failed_pb)
    explain = {}

    result = lp.run_valuations(
        ticker="TEST",
        info_dict={"short_name": "Test Co", "info": {"sector": "Utilities"}},
        financial_dict={},
        variables_dict=_variables(),
        text="x",
        add_text=False,
        explain_collector=explain,
    )

    assert calls == 2
    assert result["Prices"]["Mean"][0] == pytest.approx(100.0)
    assert lp.PB_VALUATION_METHOD_NAME not in explain["methods"]
    assert lp.PB_VALUATION_METHOD_NAME not in explain["aggregate_investments"]
