from __future__ import annotations

from pathlib import Path

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
    assert "#### Detail" in markdown
    assert "```markdown\n# Code sample\n```" in markdown


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
        analysis_text="# TEST - Analysis file\n\nCurrent Price: 100",
        variables_dict={"price": 100},
    )

    assert text.startswith("# TEST Valuation Report")
    assert "## Valuation Decision Snapshot" in text
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
