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
    assert "resolved only by filing-backed SEC/MAYA evidence" in prompt
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
    assert prices["Overall"][0] == pytest.approx(150)
    assert prices["STD"] == pytest.approx(50)


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
    assert len(consensus["all_investments"]) == 16


def test_valuation_input_snapshot_is_exact_markdown(tmp_path: Path) -> None:
    markdown = "# TEST Analysis\n\n## Section\nA complete report without truncation."

    path, persisted = runner._write_valuation_input_markdown(tmp_path, "TEST", markdown)

    assert path.name == "TEST_valuation_input.md"
    assert path.read_bytes() == markdown.encode("utf-8")
    assert persisted == markdown


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
    assert "| Consensus Position | Short" in text
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


def test_position_formatter_distinguishes_long_short_and_no_position() -> None:
    assert runner._fmt_allocation(15_000) == "Long — 15.0% of $100,000 notional ($15,000.00)"
    assert runner._fmt_allocation(-15_000) == "Short — 15.0% of $100,000 notional ($15,000.00)"
    assert runner._fmt_allocation(0) == "No Position — 0.0% of $100,000 notional ($0.00)"
