import pandas as pd

from ai_hedge import legacy_port
from ai_hedge import service


def _capture_prompt(monkeypatch):
    captured = []

    def fake_deepseek(**kwargs):
        captured.append(kwargs["prompt"])
        return "ok"

    monkeypatch.setattr(legacy_port, "deepseek_simple_text", fake_deepseek)
    return captured


def test_profile_analysis_prompts_exclude_provider_financial_summary(monkeypatch):
    captured = _capture_prompt(monkeypatch)
    info_dict = {
        "info": {
            "shortName": "RIT 1",
            "symbol": "RIT1.TA",
            "longBusinessSummary": "Owns income-producing real estate.",
            "marketCap": 2_500,
            "revenueGrowth": -0.128,
            "grossMargins": 0.94763,
            "totalRevenue": 509_428_000,
        }
    }

    legacy_port.what_it_does_insights_result(info_dict)
    legacy_port.info_insights_result(info_dict)

    prompt = "\n".join(captured)
    assert "RIT 1" in prompt
    assert "revenueGrowth" not in prompt
    assert "grossMargins" not in prompt
    assert "totalRevenue" not in prompt
    assert "-0.128" not in prompt


def test_multiple_prompt_keeps_valuation_and_drops_financial_data(monkeypatch):
    captured = _capture_prompt(monkeypatch)
    info_dict = {
        "info": {"shortName": "RIT 1", "revenueGrowth": -0.128},
        "yahooquery": {
            "status": "success",
            "ticker": "RIT1.TA",
            "valuation_measures": {
                "rows": [
                    {
                        "asOfDate": "2026-06-30",
                        "periodType": "TTM",
                        "PeRatio": 8.5,
                        "PsRatio": 4.1,
                        "grossMargins": 0.94763,
                    }
                ]
            },
            "financial_data": {"revenueGrowth": -0.128, "grossMargins": 0.94763},
        },
    }

    header, result = legacy_port.multiple_insights_result(info_dict)

    assert header == "Multiple Analysis"
    assert result == "ok"
    assert "PeRatio" in captured[0]
    assert "PsRatio" in captured[0]
    assert "financial_data" not in captured[0]
    assert "revenueGrowth" not in captured[0]
    assert "grossMargins" not in captured[0]
    assert "-0.128" not in captured[0]


def test_final_valuation_prompt_defensively_ignores_legacy_info_financials():
    prompt = legacy_port.build_prompt(
        "RIT1.TA",
        {
            "All Reports": "STATEMENT_REVENUE=100",
            "info": {
                "shortName": "RIT 1",
                "marketCap": 2_500,
                "revenueGrowth": -0.128,
                "grossMargins": 0.94763,
            },
            "info_financials": {"revenueGrowth": -0.128, "grossMargins": 0.94763},
            "currency_statement": "Financial data is in USD",
            "rate": 4.2,
        },
        "Return JSON",
        "Prepared analysis",
    )

    assert "STATEMENT_REVENUE=100" in prompt
    assert "RIT 1" in prompt
    assert "revenueGrowth" not in prompt
    assert "grossMargins" not in prompt
    assert "-0.128" not in prompt
    assert "Relevant financial data from the Company Profile Stats" not in prompt


def test_sec_analysis_prompt_uses_allowlisted_profile(monkeypatch):
    captured = _capture_prompt(monkeypatch)

    text, errors = service._generate_sec_analysis_text(
        ticker="RIT1.TA",
        info_dict={
            "info": {
                "shortName": "RIT 1",
                "longBusinessSummary": "Owns income-producing real estate.",
                "revenueGrowth": -0.128,
                "grossMargins": 0.94763,
            }
        },
        files_dict={"MAYA Annual": {"date": "2025-12-31", "text": "OFFICIAL FILING"}},
        financial_dict={"All Reports": "STATEMENT_REVENUE=100"},
        short_mode=False,
    )

    assert text == "ok\n\nok"
    assert errors == []
    prompt = "\n".join(captured)
    assert "RIT 1" in prompt
    assert "OFFICIAL FILING" in prompt
    assert "STATEMENT_REVENUE=100" in prompt
    assert "revenueGrowth" not in prompt
    assert "grossMargins" not in prompt
    assert "-0.128" not in prompt


def test_statement_metrics_use_four_quarters_and_latest_balance_sheet():
    columns = pd.to_datetime(["2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"])
    quarterly_income = pd.DataFrame(
        [[40, 30, 20, 10], [4, 3, 2, 1]],
        index=["Total Revenue", "Net Income"],
        columns=columns,
    )
    quarterly_balance = pd.DataFrame(
        [[50, 40, 30, 20], [10, 9, 8, 7], [30, 29, 28, 27], [200, 190, 180, 170], [400, 390, 380, 370], [120, 110, 100, 90], [60, 55, 50, 45]],
        index=[
            "Cash Cash Equivalents And Short Term Investments",
            "Current Debt",
            "Long Term Debt",
            "Stockholders Equity",
            "Total Assets",
            "Current Assets",
            "Current Liabilities",
        ],
        columns=columns,
    )
    quarterly_cashflow = pd.DataFrame(
        [[15, 14, 13, 12], [-5, -4, -3, -2]],
        index=["Operating Cash Flow", "Capital Expenditure"],
        columns=columns,
    )

    metrics = legacy_port._build_statement_metrics(
        financials_annual=pd.DataFrame(),
        financials_quarterly=quarterly_income,
        balance_sheet_annual=pd.DataFrame(),
        balance_sheet_quarterly=quarterly_balance,
        cashflow_annual=pd.DataFrame(),
        cashflow_quarterly=quarterly_cashflow,
        currency_rate=2,
    )

    assert metrics["source"] == "yfinance_statement_tables"
    assert metrics["revenue"] == 50
    assert metrics["net_income"] == 5
    assert metrics["free_cashflow"] == 20
    assert metrics["total_cash"] == 25
    assert metrics["total_debt"] == 20
    assert metrics["total_equity"] == 100
    assert metrics["total_assets"] == 200
    assert metrics["current_ratio"] == 2
    assert metrics["equity_to_assets"] == 0.5
