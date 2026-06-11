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
