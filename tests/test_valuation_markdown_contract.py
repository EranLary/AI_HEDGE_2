from __future__ import annotations

from pathlib import Path

import pytest

from ai_hedge import legacy_port, runner


def _financial_dict() -> dict:
    return {
        "All Reports": "STATEMENT_REVENUE=100",
        "info": {"shortName": "Test Company", "marketCap": 1_000},
        "currency_statement": "Financial data is in USD",
        "rate": 4.0,
    }


def test_valuation_prompt_marks_full_markdown_and_enforces_evidence_discipline() -> None:
    prompt = legacy_port.build_prompt(
        "TEST",
        _financial_dict(),
        "Return JSON",
        "# TEST Analysis\n\n## SEC Summary\nRevenue was 100.",
    )

    assert prompt.count("<Evidence_Discipline>") == 1
    assert '<Analysis_Document format="markdown">' in prompt
    assert "full Markdown, not summarized or shortened" in prompt
    assert '"SEC Summary (Warning)"' in prompt
    assert "exclude it from valuation calculations and assumptions" in prompt
    assert "Do not average, reconcile, select, or invent" in prompt
    assert "Final self-check before returning JSON" in prompt
    assert "include the formula and the numeric inputs used" in prompt
    assert "Hybrid Valuation Snapshot Contract" in prompt
    assert "Hybrid boundary when present, then filing-backed SEC/MAYA evidence" in prompt
    for label in (
        "[REPORTED FACT]",
        "[CALCULATION]",
        "[MANAGEMENT GUIDANCE]",
        "[ANALYST ESTIMATE]",
    ):
        assert label in prompt


def test_analysis_writer_uses_one_h1_and_nests_section_headings(tmp_path: Path) -> None:
    output = tmp_path / "analysis.md"
    legacy_port.generate_first_text("TEST", {"price": 10, "market_cap": 100}, str(output))
    legacy_port.append_text_to_file(
        text="# Inner\n\n## Detail\n\n```markdown\n# Code sample\n```",
        header="Outer",
        file_path=str(output),
    )

    markdown = output.read_text(encoding="utf-8")
    lines_outside_fences = []
    in_fence = False
    for line in markdown.splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if not in_fence:
            lines_outside_fences.append(line)
    assert [line for line in lines_outside_fences if line.startswith("# ")] == [
        "# TEST - Analysis file"
    ]
    assert "## Outer" in markdown
    assert "### Inner" in markdown
    assert "**Detail**" in markdown
    assert "####" not in "\n".join(lines_outside_fences)
    assert "```markdown\n# Code sample\n```" in markdown


def test_target_consensus_dispersion_uses_equal_weight_method_families() -> None:
    method_means, prices = legacy_port.make_short_list_prices(
        [
            ([100], "Scenario DCF"),
            ([200] * 10, "Dream Team"),
        ],
        1,
    )

    assert method_means == [100, 200]
    assert prices["Mean"][0] == pytest.approx(150)
    assert prices["Median"][0] == pytest.approx(150)
    assert "Overall" not in prices
    assert prices["STD"] == pytest.approx(50)


def test_target_consensus_median_uses_one_value_per_method_family() -> None:
    method_means, prices = legacy_port.make_short_list_prices(
        [
            ([100], "Scenario DCF"),
            ([200] * 10, "Dream Team"),
            ([1_000], "SOTP Scenario"),
        ],
        1,
    )

    assert method_means == [100, 200, 1_000]
    assert prices["Mean"][0] == pytest.approx(433.3333333333)
    assert prices["Median"][0] == pytest.approx(200)
    assert "Overall" not in prices


def test_position_consensus_counts_dream_team_as_one_method_family() -> None:
    family_amounts = {
        "Scenario DCF": [15_000],
        "Target Scenario": [20_000],
        "Earnings Scenario": [12_000],
        "Revenue Scenario": [20_000],
        "Composite Scenario": [12_000],
        "SOTP Scenario": [-15_000],
        "Dream Team": [2_500] * 10,
    }
    details = {
        method: [{"investment_amount": amount} for amount in amounts]
        for method, amounts in family_amounts.items()
    }

    consensus = legacy_port._method_family_investment_consensus(details)

    assert consensus["aggregate_investments"]["Dream Team"] == pytest.approx(2_500)
    assert consensus["mean_investment"] == pytest.approx(9_500)
    assert consensus["median_investment"] == pytest.approx(12_000)
    assert consensus["decision_investment"] == pytest.approx(10_750)
    assert len(consensus["all_investments"]) == 16


def test_valuation_input_snapshot_is_exact_markdown(tmp_path: Path) -> None:
    markdown = "# TEST Analysis\n\n## Section\nA complete report without truncation."

    path, persisted = runner._write_valuation_input_markdown(tmp_path, "TEST", markdown)

    assert path.name == "TEST_valuation_input.md"
    assert path.read_bytes() == markdown.encode("utf-8")
    assert persisted == markdown


def test_valuation_prompt_redacts_numeric_share_counts_everywhere() -> None:
    markdown = """# TEST

## Narrative
25,000,000 shares times price supports market cap.
The diluted shares outstanding were 25.0 million.
Share count: 25M.
The 25m-share base was stable.
The filing lists 25 million ordinary shares.
Share count has stayed at 25m.
Insiders own 80% and no options were granted.
"""

    prepared = legacy_port.prepare_valuation_prompt_markdown(markdown)

    assert prepared.count("[numeric share denominator withheld]") == 6
    assert "25,000,000 shares" not in prepared
    assert "25.0 million" not in prepared
    assert "Share count: 25M" not in prepared
    assert "25m-share base" not in prepared
    assert "25 million ordinary shares" not in prepared
    assert "Share count has stayed at 25m" not in prepared
    assert "Insiders own 80%" in prepared


def test_valuation_prompt_removes_share_columns_from_structured_financial_data() -> None:
    financial_dict = _financial_dict()
    financial_dict["All Reports"] = """### Income Statement
```csv
Reporting_Period,Net Income,Diluted Average Shares,Basic Average Shares,Diluted EPS
2025-12-31,100,25000000,25000000,4.0
```
"""
    financial_dict["info"] = {
        "shortName": "Test Company",
        "marketCap": 1_000,
        "sharesOutstanding": 25_000_000,
        "floatShares": 5_000_000,
    }

    prompt = legacy_port.build_prompt(
        "TEST",
        financial_dict,
        "Return JSON",
        "# TEST Analysis",
    )

    assert "Diluted Average Shares" not in prompt
    assert "Basic Average Shares" not in prompt
    assert "sharesOutstanding" not in prompt
    assert "floatShares" not in prompt
    assert "25000000" not in prompt
    assert "Reporting_Period,Net Income,Diluted EPS" in prompt


def test_hybrid_valuation_snapshot_uses_reconciled_boundary_values() -> None:
    markdown = "# TEST - Analysis file\n\nCurrent Price: 10\n\nMarket Cap: 100\n\nCurrency: 1.0\n"
    synchronized = runner._synchronize_hybrid_valuation_snapshot(
        markdown,
        variables_dict={"price": 10, "market_cap": 120},
        currency="USD",
    )
    assert "Current Price: 10" in synchronized
    assert "Market Cap: 120" in synchronized
    assert "Currency: USD" in synchronized
    assert "Market Cap: 100" not in synchronized
    assert synchronized.count("## Hybrid Valuation Snapshot Contract") == 1
    assert "already-normalized valuation snapshot" in synchronized
    assert "Do not re-label it, apply another FX conversion" in synchronized
    assert "Do not infer, recompute, or introduce a share count" in synchronized
    assert "Never divide Market Cap by Current Price" in synchronized
    assert "25,000,000" not in synchronized


def test_hybrid_snapshot_withholds_conflicting_market_cap_narratives() -> None:
    markdown = """# TEST

Current Price: 35

Market Cap: 875000000

Currency: USD

## Filing Narrative
The provided market cap is approximately NIS 875m.
The modest market capitalization increases liquidity risk.
"""

    synchronized = runner._synchronize_hybrid_valuation_snapshot(
        markdown,
        variables_dict={"price": 35, "market_cap": 875_000_000},
        currency="USD",
    )

    assert "Market Cap: 875000000" in synchronized
    assert "provided market cap is approximately NIS 875m" not in synchronized
    assert "[non-authoritative market-cap narrative withheld" in synchronized
    assert "modest market capitalization increases liquidity risk" in synchronized


def test_hybrid_valuation_snapshot_contract_is_idempotent() -> None:
    markdown = "# TEST\n\nCurrent Price: 10\n\nMarket Cap: 100\n\nCurrency: USD\n\n## Body\nText"
    first = runner._synchronize_hybrid_valuation_snapshot(
        markdown,
        variables_dict={"price": 10, "market_cap": 100},
        currency="USD",
    )
    second = runner._synchronize_hybrid_valuation_snapshot(
        first,
        variables_dict={"price": 10, "market_cap": 100},
        currency="USD",
    )

    assert second == first
    assert second.count("## Hybrid Valuation Snapshot Contract") == 1


def test_valuation_report_uses_clear_sections_and_position_labels() -> None:
    text = runner._build_prices_explain_text(
        "TEST",
        {
            "current_price": 100,
            "methods": {
                "Dream Team": [
                    {
                        "persona": "Peter Lynch",
                        "target_price": 120,
                        "investment_amount": -15_000,
                        "raw_json": {
                            "target_market_cap": 1_200_000,
                            "target_market_cap_rationale": "[ANALYST ESTIMATE] Multiple-based target.",
                        },
                    }
                ]
            },
            "aggregate_targets": {"Dream Team": 120},
            "aggregate_investments": {"Dream Team": -15_000},
        },
        final_dict={"Prices": {"CV": 0.1, "LMIL": [-15.0, 0.2]}},
        analysis_text="# TEST - Analysis file\n\nCurrent Price: 100",
        variables_dict={"price": 100},
    )

    assert text.startswith("# TEST Valuation Report")
    assert "## Valuation Decision Snapshot" in text
    assert "| Mean Allocation | Short" in text
    assert "| Median Allocation | Not available |" in text
    assert "| Consensus Allocation | Short" in text
    assert "| Consensus Target Price | $120.00 |" in text
    assert "| Consensus Basis | Mean only (Median unavailable) |" in text
    assert "| Target Range | $120.00 – $120.00 |" in text
    assert "| Valuation Methods | 1 |" in text
    assert "| Model Runs | 1 |" in text
    assert "| Consensus Confidence | N/A — fewer than two valuation methods |" in text
    assert "## Valuation Method Comparison" in text
    assert "| Dream Team | $120.00 | +20.00% | Short | 15.0% of $100,000 notional ($15,000.00) |" in text
    assert "Average Recommended Position: Short — 15.0% of $100,000 notional ($15,000.00)" in text
    assert "### Peter Lynch — AI Persona" in text
    assert "**Valuation Inputs and Outputs**" in text
    assert "**Method Rationale and Key Assumptions**" in text
    assert "**Target Market Cap Rationale:**" in text
    assert "Prices Explain" not in text
    assert "Output 1" not in text
    assert "####" not in text


def test_valuation_report_renders_pb_inputs_and_rationales() -> None:
    text = runner._build_prices_explain_text(
        "BANK",
        {
            "current_price": 50,
            "methods": {
                "P/B Valuation": [
                    {
                        "target_price": 70,
                        "investment_amount": 10_000,
                        "raw_json": {
                            "step_by_step_analysis": "[REPORTED FACT] Started from reported common equity.",
                            "representative_book_equity": 1_000_000_000,
                            "representative_book_equity_rationale": "[CALCULATION] Reported equity plus supported normalization.",
                            "pb_multiple": 1.4,
                            "pb_multiple_rationale": "[ANALYST ESTIMATE] Sustainable ROE supports 1.4 times book.",
                            "target_market_cap": 1_400_000_000,
                            "investment_amount": 10_000,
                            "investment_rationale": "Positive asymmetry supports a measured long.",
                        },
                    }
                ]
            },
            "aggregate_targets": {"P/B Valuation": 70},
            "aggregate_investments": {"P/B Valuation": 10_000},
        },
        final_dict={"Prices": {"Mean": [70, 70, 70], "LMIL Mean Investment": 10_000}},
        analysis_text="# BANK - Analysis file\n\nCurrent Price: 50",
        variables_dict={"price": 50},
    )

    assert "| P/B Valuation | $70.00 | +40.00% | Long |" in text
    assert "Representative Book Equity" in text
    assert "P/B Multiple" in text
    assert "Target Market Cap" in text
    assert "**Representative Book Equity Rationale:**" in text
    assert "**P/B Multiple Rationale:**" in text


def test_valuation_report_uses_sector_weighted_consensus_components() -> None:
    text = runner._build_prices_explain_text(
        "TEST",
        {
            "current_price": 100,
            "methods": {
                "Scenario DCF": [{"target_price": 100, "investment_amount": 10_000}],
                "Target Scenario": [{"target_price": 120, "investment_amount": 20_000}],
            },
            "aggregate_targets": {
                "Scenario DCF": 100,
                "Target Scenario": 120,
                "Sector-Weighted Valuation": 150,
            },
            "aggregate_investments": {
                "Scenario DCF": 10_000,
                "Target Scenario": 20_000,
                "Sector-Weighted Valuation": 30_000,
            },
            "sector_weighted_valuation": {
                "target_price": 150,
                "investment_amount": 30_000,
            },
        },
        final_dict={
            "Prices": {
                "Mean": [120, 120, 120],
                "Median": [110, 110, 110],
                "Sector-Weighted Valuation": [150, 150, 150],
                "LMIL Mean Investment": 10_000,
                "LMIL Median Investment": 20_000,
            }
        },
        analysis_text="# TEST - Analysis file\n\nCurrent Price: 100",
        variables_dict={"price": 100},
    )

    assert "| Sector-Weighted Target Price | $150.00 |" in text
    assert "| Consensus Target Price | $129.00 |" in text
    assert "| Sector-Weighted Allocation | Long" in text
    assert "| Consensus Allocation | Long — 21.0%" in text
    assert "| Consensus Score | 25.8000 |" in text
    assert "| Consensus Basis | 30% Mean / 30% Median / 40% Sector-Weighted |" in text
    assert "| Allocation Basis | 30% Mean / 30% Median / 40% Sector-Weighted |" in text


def test_dashboard_signal_snapshot_labels_sector_weighted_basis() -> None:
    text = runner._build_dashboard_signal_snapshot_text(
        {
            "header": {"currency": "USD", "current_price": 100},
            "valuation_hub": {
                "consensus": {
                    "current_price": 100,
                    "mean_target_price": 120,
                    "median_target_price": 110,
                    "sector_weighted_target_price": 150,
                    "decision_target_price": 129,
                    "component_weights": {"mean": 0.3, "median": 0.3, "sector_weighted": 0.4},
                }
            },
            "score_card": {
                "median_investment_amount": 20_000,
                "position_size_pct_of_notional": 21,
                "adjusted_score": 12.3,
            },
        }
    )

    assert "Sector-Weighted Target Price: $150.00" in text
    assert "Consensus Basis: 30% Mean / 30% Median / 40% Sector-Weighted" in text
    assert "50% Mean / 50% Median" not in text


def test_position_formatter_distinguishes_long_short_and_no_position() -> None:
    assert runner._fmt_allocation(15_000) == "Long — 15.0% of $100,000 notional ($15,000.00)"
    assert runner._fmt_allocation(-15_000) == "Short — 15.0% of $100,000 notional ($15,000.00)"
    assert runner._fmt_allocation(0) == "No Position — 0.0% of $100,000 notional ($0.00)"
