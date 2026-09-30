from __future__ import annotations

import pytest

from ai_hedge import legacy_port as lp


_SHARE_COUNT_CONTRACT = (
    "S is the backend's separately resolved total-company valuation share count. "
    "Its numeric value is intentionally not provided"
)


@pytest.mark.parametrize(
    ("prompt", "formula_fragments"),
    [
        (
            lp.instructions_scenario_dcf,
            (
                "FCF_s,t = fcf_next_year_s * (1 + g_s) ** t",
                "DCF_EV_s = sum(",
                "EV_to_equity_adjustment = representative_ev_current - current_market_cap",
                "final_target_price = max(0, sum(probability_s * scenario_price_s))",
            ),
        ),
        (
            lp.instructions_pb_valuation,
            (
                "target_market_cap = representative_book_equity * pb_multiple",
                "final_target_price = target_market_cap / S",
            ),
        ),
        (
            lp.instructions_target_market_cap,
            ("final_target_price = target_market_cap / S",),
        ),
        (
            lp.instructions_bull_base_bear_target,
            (
                "final_target_price = max(0, sum(probability_s * target_market_cap_s / S))",
            ),
        ),
        (
            lp.instructions_bull_base_bear_ni_pe,
            (
                "expected_net_income_3y = sum(probability_s * net_income_3y_normalized_s)",
                "target_market_cap = expected_net_income_3y * pe_multiple",
                "final_target_price = max(0, target_market_cap / S)",
            ),
        ),
        (
            lp.instructions_revenue_scenario,
            (
                "expected_revenue_3y = sum(probability_s * revenue_3y_normalized_s)",
                "target_EV = expected_revenue_3y * ev_sales_multiple",
                "EV_to_equity_adjustment = representative_ev_current - current_market_cap",
                "final_target_price = max(0, (target_EV - EV_to_equity_adjustment) / S)",
            ),
        ),
        (
            lp.instructions_composite_scenario,
            (
                "revenue_3y_s = representative_revenue_current_year * (1 + revenue_growth_3y_avg_s) ** 3",
                "net_income_s = (operating_earnings_s + net_financing_result_s) * (1 - tax_rate_s)",
                "scenario_price_s = max(0, net_income_s * pe_multiple_s / S)",
                "final_target_price = sum(probability_s * scenario_price_s)",
            ),
        ),
        (
            lp.instructions_sotp_scenario,
            (
                "scenario_equity_value_s = sum(all activity values in that scenario, including \"Equity Adjustments\")",
                "scenario_price_s = max(0, scenario_equity_value_s / S)",
                "final_target_price = sum(probability_s * scenario_price_s)",
            ),
        ),
    ],
)
def test_every_valuation_instruction_explains_its_backend_price_formula(
    prompt: str,
    formula_fragments: tuple[str, ...],
) -> None:
    assert prompt.count("Deterministic target-price calculation after your JSON:") == 1
    assert _SHARE_COUNT_CONTRACT in prompt
    assert "supported dilution, issuance, buybacks" in prompt
    assert "do not estimate, request, or return it" in prompt
    for fragment in formula_fragments:
        assert fragment in prompt


@pytest.mark.parametrize("persona", tuple(lp.DREAM_TEAM_DESCRIPTION_FILES))
def test_every_dream_team_valuator_receives_the_price_formula(persona: str) -> None:
    prompt = lp.build_prompt_dream_valuation(persona)

    assert prompt.count("Deterministic target-price calculation after your JSON:") == 1
    assert "persona_target_price = target_market_cap / S" in prompt
    assert "arithmetic mean that forms the single Dream Team family target" in prompt
    assert _SHARE_COUNT_CONTRACT in prompt
    assert "supported dilution, issuance, buybacks" in prompt
    assert "do not estimate, request, or return it" in prompt


def test_valuation_prompt_does_not_disclose_selected_or_provider_share_counts() -> None:
    financial_dict = {
        "All Reports": "STATEMENT_REVENUE=100",
        "info": {
            "shortName": "Test Company",
            "currentPrice": 25,
            "marketCap": 2_500_000_000,
            "sharesOutstanding": 91_111_111,
            "impliedSharesOutstanding": 92_222_222,
        },
        "currency_statement": "Financial data is in USD",
        "rate": 4.0,
    }
    analysis = """# TEST Analysis

## Business
The business evidence remains available.

## Verified Share Count for Valuation
This denominator is used consistently for every valuation.
- Selected total-company shares: 93,333,333
- Basis: latest official filing

## Risks
Dilution and buybacks remain relevant qualitative considerations.
"""

    prompt = lp.build_prompt(
        "TEST",
        financial_dict,
        lp.instructions_bull_base_bear_ni_pe,
        analysis,
    )

    assert "Verified Share Count for Valuation" not in prompt
    assert "93,333,333" not in prompt
    assert "sharesOutstanding" not in prompt
    assert "91111111" not in prompt
    assert "impliedSharesOutstanding" not in prompt
    assert "92222222" not in prompt
    assert "currentPrice" in prompt
    assert "marketCap" in prompt
    assert "The business evidence remains available." in prompt
    assert "Dilution and buybacks remain relevant qualitative considerations." in prompt


def test_prepare_valuation_prompt_markdown_removes_only_share_count_section() -> None:
    analysis = """# TEST Analysis

## Before
Keep before.

## Verified Share Count for Valuation
- Selected total-company shares: 93,333,333

## After
Keep after.
"""

    prepared = lp.prepare_valuation_prompt_markdown(analysis)

    assert prepared.startswith("# TEST Analysis")
    assert "## Before\nKeep before." in prepared
    assert "Verified Share Count for Valuation" not in prepared
    assert "93,333,333" not in prepared
    assert "## After\nKeep after." in prepared
