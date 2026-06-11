from ai_hedge.financials_agent import REQUIRED_METRICS, financials_analysis_to_markdown, normalize_financials_analysis


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
    sbc_ratio = next(row for row in normalized["rows"] if row["metric"] == "SBC / Revenue")
    assert equity_to_assets["kind"] == "percent"
    assert tax_rate["kind"] == "percent"
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
