from unittest.mock import patch

import pandas as pd

from ai_hedge.financials_agent import (
    REQUIRED_METRICS,
    build_financials_prompt,
    build_raw_financials_payload,
    financials_analysis_to_markdown,
    normalize_financials_analysis,
)


class EmptyTicker:
    def __init__(self, info):
        self.info = info
        self.financials = pd.DataFrame()
        self.quarterly_financials = pd.DataFrame()
        self.balance_sheet = pd.DataFrame()
        self.quarterly_balance_sheet = pd.DataFrame()
        self.cashflow = pd.DataFrame()
        self.quarterly_cashflow = pd.DataFrame()


def test_build_raw_financials_payload_uses_original_provider_currency_quote_fields():
    provider_info = {
        "symbol": "AXN.TA",
        "shortName": "Axsion Ltd",
        "currency": "ILA",
        "financialCurrency": "ILS",
        "currentPrice": 724.6,
        "sharesOutstanding": 18277780,
        "marketCap": 132440792,
        "enterpriseValue": 110804120,
        "priceToBook": 5.031944,
        "enterpriseToRevenue": 6.37,
        "totalDebt": 2710000,
        "totalCash": 24949000,
        "totalRevenue": 17395000,
    }
    legacy_converted_info = {
        "info": {
            "symbol": "AXN.TA",
            "currency": "USD",
            "financialCurrency": "USD",
            "original_price_currency": "ILA",
            "original_financial_currency": "ILS",
            "currentPrice": 2.356,
            "marketCap": 43064880,
            "enterpriseValue": 36029560,
            "totalDebt": 881177,
            "totalCash": 8112518,
            "totalRevenue": 5656071,
        }
    }

    with patch("ai_hedge.financials_agent.yf.Ticker", return_value=EmptyTicker(provider_info)):
        payload = build_raw_financials_payload("AXN.TA", legacy_converted_info)

    assert payload["currency"] == "ILS"
    assert payload["price_currency"] == "ILA"
    assert payload["currency_policy"] == "original_provider_currency_only"
    assert payload["info"]["current_price"] == 724.6
    assert payload["info"]["market_cap"] == 132440792
    assert payload["info"]["enterprise_value"] == 110804120
    assert "total_debt" not in payload["info"]
    assert "total_cash" not in payload["info"]
    assert "total_revenue" not in payload["info"]
    assert "financial_currency_to_USD" not in payload["info"]


def test_build_raw_financials_payload_quarantines_yahooquery_financial_data():
    info_dict = {
        "info": {"symbol": "RIT1.TA", "original_financial_currency": "ILS"},
        "yahooquery": {
            "status": "success",
            "ticker": "RIT1.TA",
            "valuation_measures": {
                "latest": {"periodType": "TTM", "PeRatio": 8.5, "PsRatio": 4.1}
            },
            "financial_data": {"revenueGrowth": -0.128, "grossMargins": 0.94763},
        },
    }

    with patch("ai_hedge.financials_agent.yf.Ticker", return_value=EmptyTicker({})):
        payload = build_raw_financials_payload("RIT1.TA", info_dict)

    assert "financial_data" not in payload["yahooquery"]
    assert payload["yahooquery"]["valuation_measures"]["latest"]["PeRatio"] == 8.5
    prompt = build_financials_prompt("RIT1.TA", payload)
    assert "revenueGrowth" not in prompt
    assert "grossMargins" not in prompt
    assert "yahooquery financial_data" not in prompt


def test_normalize_financials_analysis_preserves_required_order_and_caps_added_rows():
    raw = {
        "ticker": "TEST",
        "currency": "ILS",
        "unit": "raw",
        "periods": [
            {"key": "2025-03-31_Q", "label": "Q1 2025", "date": "2025-03-31", "period_type": "quarterly"},
            {"key": "2024-12-31_A", "label": "FY 2024", "date": "2024-12-31", "period_type": "annual"},
        ],
        "rows": [
            {
                "metric": "Revenue",
                "kind": "currency",
                "values": {"2024-12-31_A": 100, "2025-03-31_Q": 35},
                "quality": "reported",
                "note": "Reported revenue.",
            },
            *[
                {
                    "metric": f"Optional {idx}",
                    "kind": "currency",
                    "values": {"2024-12-31_A": idx},
                    "quality": "derived",
                    "note": "",
                }
                for idx in range(10)
            ],
        ],
    }

    normalized = normalize_financials_analysis(raw, ticker="TEST", currency="USD")

    assert normalized["currency"] == "ILS"
    assert [p["key"] for p in normalized["periods"]] == ["2024-12-31_A", "2025-03-31_Q"]
    assert [row["metric"] for row in normalized["rows"][: len(REQUIRED_METRICS)]] == REQUIRED_METRICS
    assert len(normalized["rows"]) == len(REQUIRED_METRICS) + 7
    assert normalized["rows"][0]["values"]["2024-12-31_A"] == 100
    assert "Total Assets" in [row["metric"] for row in normalized["rows"]]
    assert "Net Liquidity: Liquid Assets Less Debt" in [row["metric"] for row in normalized["rows"]]
    equity_to_assets = next(row for row in normalized["rows"] if row["metric"] == "Equity-to-Assets Ratio")
    tax_rate = next(row for row in normalized["rows"] if row["metric"] == "Tax Rate")
    capex = next(row for row in normalized["rows"] if row["metric"] == "Capital Expenditures (Capex)")
    capex_ratio = next(row for row in normalized["rows"] if row["metric"] == "Capex / Revenue")
    working_capital = next(row for row in normalized["rows"] if row["metric"] == "Working Capital")
    ebitda = next(row for row in normalized["rows"] if row["metric"] == "EBITDA")
    ebitda_margin = next(row for row in normalized["rows"] if row["metric"] == "EBITDA Margin")
    sbc_ratio = next(row for row in normalized["rows"] if row["metric"] == "SBC / Revenue")
    assert REQUIRED_METRICS[REQUIRED_METRICS.index("Operating Margin") + 1 : REQUIRED_METRICS.index("Operating Margin") + 3] == [
        "EBITDA",
        "EBITDA Margin",
    ]
    assert equity_to_assets["kind"] == "percent"
    assert tax_rate["kind"] == "percent"
    assert ebitda["kind"] == "currency"
    assert ebitda_margin["kind"] == "percent"
    assert capex["kind"] == "currency"
    assert capex_ratio["kind"] == "percent"
    assert working_capital["kind"] == "currency"
    assert sbc_ratio["kind"] == "percent"


def test_normalize_financials_analysis_canonicalizes_curly_shareholders_equity():
    normalized = normalize_financials_analysis(
        {
            "periods": [{"key": "2024-12-31_A", "label": "FY 2024", "date": "2024-12-31", "period_type": "annual"}],
            "rows": [
                {
                    "metric": "Total Shareholders’ Equity",
                    "kind": "currency",
                    "values": {"2024-12-31_A": 500},
                    "quality": "reported",
                    "note": "",
                }
            ],
        },
        ticker="TEST",
        currency="USD",
    )

    row = next(row for row in normalized["rows"] if row["metric"] == "Total Shareholders' Equity")
    assert row["values"]["2024-12-31_A"] == 500


def test_normalize_financials_analysis_canonicalizes_working_capital_alias():
    normalized = normalize_financials_analysis(
        {
            "periods": [{"key": "2024-12-31_A", "label": "FY 2024", "date": "2024-12-31", "period_type": "annual"}],
            "rows": [
                {
                    "metric": "Net Working Capital",
                    "kind": "currency",
                    "values": {"2024-12-31_A": 250},
                    "quality": "derived",
                    "note": "Current assets less current liabilities.",
                }
            ],
        },
        ticker="TEST",
        currency="USD",
    )

    row = next(row for row in normalized["rows"] if row["metric"] == "Working Capital")
    assert row["values"]["2024-12-31_A"] == 250
    assert row["quality"] == "derived"


def test_financials_markdown_includes_currency_and_table():
    analysis = normalize_financials_analysis(
        {
            "ticker": "TEST",
            "currency": "USD",
            "unit": "raw",
            "periods": [{"key": "2024-12-31_A", "label": "FY 2024", "date": "2024-12-31", "period_type": "annual"}],
            "rows": [
                {
                    "metric": "Revenue",
                    "kind": "currency",
                    "values": {"2024-12-31_A": 1000},
                    "quality": "reported",
                    "note": "Reported.",
                }
            ],
            "key_takeaways": ["Revenue grew."],
        },
        ticker="TEST",
        currency="USD",
    )

    markdown = financials_analysis_to_markdown(analysis)

    assert "## Financials" in markdown
    assert "- Currency: USD" in markdown
    assert "| Revenue | 1,000 | Reported. |" in markdown


def test_normalize_financials_analysis_sorts_q4_before_fy_and_moves_market_snapshot():
    normalized = normalize_financials_analysis(
        {
            "ticker": "TEST",
            "periods": [
                {"key": "2025-09-30_A", "label": "FY 2025", "date": "2025-09-30", "period_type": "annual"},
                {"key": "2025-09-30_Q", "label": "Q4 2025", "date": "2025-09-30", "period_type": "quarterly"},
            ],
            "rows": [
                {
                    "metric": "Market Capitalization",
                    "kind": "currency",
                    "values": {"2025-09-30_A": 0, "2025-09-30_Q": 1000},
                    "quality": "mixed",
                    "note": "Current quote.",
                },
                {
                    "metric": "(+) Amortization of Intangible Assets",
                    "kind": "currency",
                    "values": {"2025-09-30_A": 0, "2025-09-30_Q": 0},
                    "quality": "unavailable",
                    "note": "Not separately disclosed.",
                },
            ],
        },
        ticker="TEST",
        currency="USD",
    )

    assert [p["key"] for p in normalized["periods"]] == ["2025-09-30_Q", "2025-09-30_A"]
    assert "Market Capitalization" not in [row["metric"] for row in normalized["rows"]]
    market_cap = next(metric for metric in normalized["current_metrics"] if metric["metric"] == "Market Capitalization")
    assert market_cap["value"] == 1000
    amortization = next(row for row in normalized["rows"] if row["metric"] == "(+) Amortization of Intangible Assets")
    assert amortization["values"] == {"2025-09-30_Q": None, "2025-09-30_A": None}


def test_normalize_financials_analysis_uses_report_date_year_for_labels():
    normalized = normalize_financials_analysis(
        {
            "ticker": "TEST",
            "periods": [
                {"key": "2026-01-31_A", "label": "FY 2027", "date": "2026-01-31", "period_type": "annual"},
                {"key": "2026-04-30_Q", "label": "Q1 2027", "date": "2026-04-30", "period_type": "quarterly"},
            ],
            "rows": [],
        },
        ticker="TEST",
        currency="USD",
    )

    assert [p["label"] for p in normalized["periods"]] == ["FY 2025", "Q1 2026"]


def test_normalize_financials_analysis_keeps_january_q4_in_sequence_year():
    normalized = normalize_financials_analysis(
        {
            "ticker": "CGNT",
            "periods": [
                {"key": "2025-04-30_Q", "label": "Q1 2025", "date": "2025-04-30", "period_type": "quarterly"},
                {"key": "2025-07-31_Q", "label": "Q2 2025", "date": "2025-07-31", "period_type": "quarterly"},
                {"key": "2025-10-31_Q", "label": "Q3 2025", "date": "2025-10-31", "period_type": "quarterly"},
                {"key": "2026-01-31_Q", "label": "Q4 2026", "date": "2026-01-31", "period_type": "quarterly"},
                {"key": "2026-01-31_A", "label": "FY 2026", "date": "2026-01-31", "period_type": "annual"},
                {"key": "2026-04-30_Q", "label": "Q1 2026", "date": "2026-04-30", "period_type": "quarterly"},
            ],
            "rows": [],
        },
        ticker="CGNT",
        currency="USD",
    )

    assert [p["label"] for p in normalized["periods"]] == [
        "Q1 2025",
        "Q2 2025",
        "Q3 2025",
        "Q4 2025",
        "FY 2025",
        "Q1 2026",
    ]


def test_normalize_financials_analysis_handles_january_retail_fiscal_calendar():
    normalized = normalize_financials_analysis(
        {
            "ticker": "WMT",
            "periods": [
                {"key": "2023-01-31_A", "label": "FY 2022", "date": "2023-01-31", "period_type": "annual"},
                {"key": "2024-01-31_A", "label": "FY 2023", "date": "2024-01-31", "period_type": "annual"},
                {"key": "2025-01-31_A", "label": "FY 2024", "date": "2025-01-31", "period_type": "annual"},
                {"key": "2025-04-30_Q", "label": "Q1 2026", "date": "2025-04-30", "period_type": "quarterly"},
                {"key": "2025-07-31_Q", "label": "Q2 2026", "date": "2025-07-31", "period_type": "quarterly"},
                {"key": "2025-10-31_Q", "label": "Q3 2026", "date": "2025-10-31", "period_type": "quarterly"},
                {"key": "2026-01-31_Q", "label": "Q4 2026", "date": "2026-01-31", "period_type": "quarterly"},
                {"key": "2026-01-31_A", "label": "FY 2025", "date": "2026-01-31", "period_type": "annual"},
                {"key": "2026-04-30_Q", "label": "Q1 2027", "date": "2026-04-30", "period_type": "quarterly"},
            ],
            "rows": [],
        },
        ticker="WMT",
        currency="USD",
    )

    assert [p["label"] for p in normalized["periods"]] == [
        "FY 2022",
        "FY 2023",
        "FY 2024",
        "Q1 2025",
        "Q2 2025",
        "Q3 2025",
        "Q4 2025",
        "FY 2025",
        "Q1 2026",
    ]
