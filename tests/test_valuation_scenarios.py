from __future__ import annotations

import json
import math

from ai_hedge import dashboard
from ai_hedge import legacy_port as lp
from ai_hedge import runner
from ai_hedge.db.transform import ticker_dir_to_row


def test_extract_revenue_scenario_json_parses_and_normalizes():
    raw = """
    {
      "step_by_step_analysis": "x",
      "bull": [40, 120000000],
      "base": [35, 100000000],
      "bear": [25, 80000000],
      "ev_sales_multiple": 3.2,
      "investment_amount": 10000,
      "investment_rationale": "x"
    }
    """
    parsed = lp.extract_revenue_scenario_json(raw)
    assert parsed
    assert abs(parsed["scenarios"]["bull"]["probability"] - 0.4) < 1e-9
    assert abs(parsed["scenarios"]["base"]["probability"] - 0.35) < 1e-9
    assert abs(parsed["scenarios"]["bear"]["probability"] - 0.25) < 1e-9
    assert parsed["ev_sales_multiple"] == 3.2


def test_extract_composite_scenario_json_normalizes_ratio_fields():
    raw = """
    {
      "step_by_step_analysis": "x",
      "bull": [0.3, 18, 22, -1000000, 25, 16],
      "base": [0.5, 12, 18, -2000000, 23, 14],
      "bear": [0.2, 6, 12, -3000000, 21, 10],
      "investment_amount": 5000,
      "investment_rationale": "x"
    }
    """
    parsed = lp.extract_composite_scenario_json(raw)
    assert parsed
    bull = parsed["scenarios"]["bull"]
    assert abs(bull["revenue_growth_3y_avg"] - 0.18) < 1e-9
    assert abs(bull["operating_profitability_margin"] - 0.22) < 1e-9
    assert abs(bull["tax_rate"] - 0.25) < 1e-9


def test_extract_sotp_scenario_json_parses_nested_activities():
    raw = """
    {
      "step_by_step_analysis": "x",
      "bull": {"probability": 0.3, "activities": {"Core": 120000000, "Adj": -10000000}},
      "base": {"probability": 0.5, "activities": {"Core": 100000000, "Adj": -5000000}},
      "bear": {"probability": 0.2, "activities": {"Core": 80000000, "Adj": -2000000}},
      "investment_amount": 7000,
      "investment_rationale": "x"
    }
    """
    parsed = lp.extract_sotp_scenario_json(raw)
    assert parsed
    assert parsed["scenarios"]["base"]["activities"]["Core"] == 100000000.0
    assert abs(parsed["scenarios"]["bear"]["probability"] - 0.2) < 1e-9


def test_run_valuations_uses_scenario_only_method_set(monkeypatch):
    def _dcf(*args, **kwargs):
        return [110.0], ("txt", "Scenario DCF Valuation"), [
            {"target_price": 110.0, "investment_amount": 1000, "raw_json": {"bull": [0.3, 1], "base": [0.5, 1], "bear": [0.2, 1], "fcf_next_year": [10, 10], "g": [0.1, 0.1], "WACC": [0.08, 0.08], "TERMINAL": [0.02, 0.02]}}
        ]

    def _target(*args, **kwargs):
        return [120.0], ("txt", "Target Scenario Valuation"), [
            {"target_price": 120.0, "investment_amount": 1000, "raw_json": {"bull": [0.3, 120000000], "base": [0.5, 100000000], "bear": [0.2, 80000000]}}
        ]

    def _earnings(*args, **kwargs):
        return [130.0], [9000000.0], [15.0], ("txt", "Earnings Scenario Valuation"), [
            {"target_price": 130.0, "investment_amount": 1000, "raw_json": {"bull": [0.3, 12000000], "base": [0.5, 9000000], "bear": [0.2, 6000000], "pe_multiple": 15}}
        ]

    def _revenue(*args, **kwargs):
        return [125.0], [3.0], [100000000.0], ("txt", "Revenue Scenario Valuation"), [
            {"target_price": 125.0, "investment_amount": 1000, "raw_json": {"bull": [0.3, 120000000], "base": [0.5, 100000000], "bear": [0.2, 80000000], "ev_sales_multiple": [3, 3]}}
        ]

    def _composite(*args, **kwargs):
        return [128.0], [105000000.0], [8500000.0], [14.0], ("txt", "Composite Scenario Valuation"), [
            {"target_price": 128.0, "investment_amount": 1000, "raw_json": {"bull": [0.3, 0.15, 0.2, -1000000, 0.23, 15], "base": [0.5, 0.1, 0.18, -2000000, 0.24, 14], "bear": [0.2, 0.05, 0.14, -3000000, 0.25, 10], "revenue_growth_3y_avg": 0.1, "operating_profitability_margin": 0.18, "net_financing_result": -2000000, "tax_rate": 0.24, "pe_multiple": 14}}
        ]

    def _sotp(*args, **kwargs):
        return [127.0], ("txt", "SOTP Scenario Valuation"), [
            {"target_price": 127.0, "investment_amount": 1000, "raw_json": {"bull": [0.3, 120000000], "base": [0.5, 100000000], "bear": [0.2, 80000000], "target_market_cap": 102000000}}
        ]

    def _dream(*args, **kwargs):
        return [140.0], ("txt", "Dream Team Target Price Valuation"), [
            {"persona": "Warren Buffett", "target_price": 140.0, "investment_amount": 1000, "raw_json": {"target_market_cap": 140000000}}
        ]

    monkeypatch.setattr(lp, "scenario_dcf_full", _dcf)
    monkeypatch.setattr(lp, "bbb_tp_full", _target)
    monkeypatch.setattr(lp, "bbb_ni_pe_full", _earnings)
    monkeypatch.setattr(lp, "revenue_scenario_full", _revenue)
    monkeypatch.setattr(lp, "composite_scenario_full", _composite)
    monkeypatch.setattr(lp, "sotp_scenario_full", _sotp)
    monkeypatch.setattr(lp, "dream_valuation_full", _dream)

    explain = {}
    final_dict = lp.run_valuations(
        ticker="TEST",
        info_dict={"short_name": "Test Co"},
        financial_dict={},
        variables_dict={
            "price_currency": 1.0,
            "financial_currency": 1.0,
            "price": 100.0,
            "revenue": 50000000.0,
            "net_income": 5000000.0,
            "market_cap": 100000000.0,
            "shares_outstanding": 1000000.0,
            "ev": 120000000.0,
        },
        text="x",
        add_text=False,
        explain_collector=explain,
    )

    assert "Prices" in final_dict
    assert "Scenario DCF" in explain["methods"]
    assert "Target Scenario" in explain["methods"]
    assert "Earnings Scenario" in explain["methods"]
    assert "Revenue Scenario" in explain["methods"]
    assert "Composite Scenario" in explain["methods"]
    assert "SOTP Scenario" in explain["methods"]
    assert "Dream Team" in explain["methods"]
    assert "DCF" not in explain["methods"]
    assert "Net Income & P/E" not in explain["methods"]
    assert "Revenue & EV/S" not in explain["methods"]
    assert "Lary's Logic" not in explain["methods"]


def test_dashboard_blended_probabilities_include_sotp_object_shape():
    method_details = {
        "SOTP Scenario": [
            {
                "raw_json": {
                    "bull": {"probability": 0.2, "activities": {"Core": 100.0, "Adj": -10.0}},
                    "base": {"probability": 0.5, "activities": {"Core": 90.0, "Adj": -5.0}},
                    "bear": {"probability": 0.3, "activities": {"Core": 70.0, "Adj": -15.0}},
                }
            }
        ]
    }
    all_values = dashboard._build_all_values_payload(method_details, final_dict={})
    rows = {row["metric_key"]: row for row in all_values["metric_means"]}

    assert abs(rows["bull_probability_blended"]["mean"] - 0.2) < 1e-9
    assert abs(rows["base_probability_blended"]["mean"] - 0.5) < 1e-9
    assert abs(rows["bear_probability_blended"]["mean"] - 0.3) < 1e-9


def test_dashboard_current_assumption_values_use_original_financial_currency_scale():
    values = dashboard._build_current_assumption_values(
        info={
            "financial_currency_to_USD": 3.5,
            "freeCashflow": 10.0,
            "enterpriseToRevenue": 2.25,
            "trailingPE": 18.0,
        },
        variables_dict={
            "financial_currency": 3.5,
            "revenue": 100.0,
            "net_income": 8.0,
            "ev": 225.0,
            "market_cap": 144.0,
        },
        final_dict={},
    )

    assert values["representative_fcf"] == 35.0
    assert values["representative_revenue"] == 350.0
    assert values["representative_earnings"] == 28.0
    assert values["representative_ev_sales"] == 2.25
    assert values["representative_pe"] == 18.0


def test_dashboard_strict_json_replaces_non_finite_values(tmp_path):
    payload = {
        "ticker": "BAD",
        "header": {
            "price_performance_pct": {
                "1D": math.nan,
                "1W": math.inf,
                "1M": -math.inf,
                "3M": 1.25,
            }
        },
    }

    out = tmp_path / "BAD_dashboard.json"
    dashboard.write_dashboard_payload(out, payload)

    raw = out.read_text(encoding="utf-8")
    assert "NaN" not in raw
    assert "Infinity" not in raw
    parsed = json.loads(raw)
    assert parsed["header"]["price_performance_pct"]["1D"] is None
    assert parsed["header"]["price_performance_pct"]["1W"] is None
    assert parsed["header"]["price_performance_pct"]["1M"] is None
    assert parsed["header"]["price_performance_pct"]["3M"] == 1.25


def test_db_transform_sanitizes_non_finite_dashboard_values(tmp_path):
    ticker_dir = tmp_path / "_site_runs" / "BAD_123" / "BAD"
    ticker_dir.mkdir(parents=True)
    (ticker_dir / "BAD_analysis.txt").write_text("analysis", encoding="utf-8")
    (ticker_dir / "BAD_dashboard.json").write_text(
        '{"ticker":"BAD","generated_at":"2026-01-01T00:00:00+00:00",'
        '"header":{"current_price":NaN,"price_performance_pct":{"1D":NaN}},'
        '"valuation_hub":{"consensus":{"mean_target_price":Infinity}}}',
        encoding="utf-8",
    )

    bundle = ticker_dir_to_row(ticker_dir, source="site")

    assert bundle is not None
    assert bundle["report_row"]["current_price"] is None
    assert bundle["report_row"]["mean_target_price"] is None
    assert bundle["artifact_row"]["dashboard"]["header"]["price_performance_pct"]["1D"] is None


def test_runner_assumptions_pack_blended_probabilities_include_sotp_object_shape():
    explain_payload = {
        "methods": {
            "SOTP Scenario": [
                {
                    "raw_json": {
                        "bull": {"probability": 0.2, "activities": {"Core": 100.0, "Adj": -10.0}},
                        "base": {"probability": 0.5, "activities": {"Core": 90.0, "Adj": -5.0}},
                        "bear": {"probability": 0.3, "activities": {"Core": 70.0, "Adj": -15.0}},
                    }
                }
            ]
        }
    }
    text = runner._build_assumptions_pack_text({}, explain_payload)
    assert "Bull Probability: 20.00%" in text
    assert "Base Probability: 50.00%" in text
    assert "Bear Probability: 30.00%" in text


def test_method_metric_snapshot_reads_sotp_scenario_activity_sums():
    items = [
        {
            "raw_json": {
                "bull": {"probability": 0.2, "activities": {"Core": 100.0, "Adj": -10.0}},
                "base": {"probability": 0.5, "activities": {"Core": 90.0, "Adj": -5.0}},
                "bear": {"probability": 0.3, "activities": {"Core": 70.0, "Adj": -15.0}},
            }
        }
    ]
    snapshot = dashboard._method_metric_snapshot("SOTP Scenario", items)
    assert abs(snapshot["bull_probability"] - 0.2) < 1e-9
    assert abs(snapshot["base_probability"] - 0.5) < 1e-9
    assert abs(snapshot["bear_probability"] - 0.3) < 1e-9
    assert abs(snapshot["target_market_cap"] - 77.0) < 1e-9
