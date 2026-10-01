from __future__ import annotations

import pytest

from ai_hedge.sector_weighted_valuation import (
    DREAM_TEAM_WEIGHTS,
    FAMILIES,
    MODEL_NAME,
    PERSONAS,
    SECTOR_WEIGHTS,
    apply_to_dashboard,
    compute_sector_weighted,
    validate_policy,
)


def test_policy_matrices_are_complete_and_keep_fixed_envelopes() -> None:
    validate_policy()
    assert set(SECTOR_WEIGHTS) == set(DREAM_TEAM_WEIGHTS)
    for row in SECTOR_WEIGHTS.values():
        assert sum(row) == 100
        assert row[FAMILIES.index("Target Scenario")] == 10
        assert row[FAMILIES.index("Dream Team")] == 10
    for row in DREAM_TEAM_WEIGHTS.values():
        assert len(row) == len(PERSONAS)
        assert sum(row) == 100


def test_missing_family_is_proportionally_renormalized_and_aliases_average() -> None:
    result = compute_sector_weighted(
        sector="Financial Services",
        observations=[
            {"name": "DCF", "target": 100, "allocation": 10_000},
            {"name": "Intrinsic DCF", "target": 120, "allocation": 20_000},
            {"name": "Earnings Scenario", "target": 200, "allocation": 30_000},
            # P/B is intentionally absent despite its 40% configured weight.
        ],
    )
    assert result is not None
    # DCF aliases first average to 110, then 5:20 renormalizes to 20%:80%.
    assert result["target_price"] == pytest.approx(182)
    rows = {row["family"]: row for row in result["family_weights"]}
    assert rows["Scenario DCF"]["effective_target_weight"] == pytest.approx(0.2)
    assert rows["Earnings Scenario"]["effective_target_weight"] == pytest.approx(0.8)
    assert rows["P/B Valuation"]["status"] == "missing"
    assert rows["P/B Valuation"]["effective_target_weight"] is None


def test_zero_weight_family_does_not_enter_weighted_value() -> None:
    result = compute_sector_weighted(
        sector="Technology",
        observations=[
            {"name": "Scenario DCF", "target": 100, "allocation": 10_000},
            {"name": "P/B Valuation", "target": 10_000, "allocation": 100_000},
        ],
    )
    assert result is not None
    assert result["target_price"] == 100
    assert result["investment_amount"] == 10_000


def test_dream_team_uses_valid_personas_and_separate_allocation_availability() -> None:
    result = compute_sector_weighted(
        sector="Technology",
        observations=[{"name": "Scenario DCF", "target": 100, "allocation": 0}],
        dream_outputs=[
            {"persona": "Aswath Damodaran", "target": 200, "allocation": 20_000},
            {"persona": "Cathie Wood", "target": 300, "allocation": None},
            {"persona": "Ray Dalio", "target": -1, "allocation": 90_000},
        ],
    )
    assert result is not None
    # Dream target is 15:18 between valid personas; family envelope remains 10%.
    dream_target = (200 * 15 + 300 * 18) / 33
    assert result["dream_team"]["target_price"] == pytest.approx(dream_target)
    assert result["dream_team"]["investment_amount"] == 20_000
    assert result["target_price"] == pytest.approx((100 * 0.20 + dream_target * 0.10) / 0.30)


def _dashboard() -> dict:
    tabs = []
    blocks = []
    for name, target, investment in [
        ("Scenario DCF", 100, 10_000),
        ("Target Scenario", 120, 20_000),
        ("Dream Team", 140, 30_000),
    ]:
        outputs = (
            [{"persona": "Warren Buffett", "target_price": 140, "investment_amount": 30_000}]
            if name == "Dream Team"
            else []
        )
        tabs.append({"name": name, "target_price": target, "investment_amount": investment, "outputs": outputs})
        blocks.append({"name": name, "target_price": target, "investment_amount": investment})
    return {
        "header": {"current_price": 100},
        "valuation_hub": {
            "method_tabs": tabs,
            "method_blocks": blocks,
            "consensus": {"current_price": 100, "mean_target_price": 120, "median_target_price": 110},
        },
        "score_card": {
            "mean_investment_amount_raw": 10_000,
            "median_investment_amount": 20_000,
            "confidence_factor": 0.8,
        },
    }


def test_dashboard_adds_model_without_changing_mean_median_and_blends_30_30_40() -> None:
    original = _dashboard()
    result = apply_to_dashboard(
        original,
        sector="Technology",
        sector_source="tickers",
        provenance="backfill",
        computed_at="2026-10-01T00:00:00+00:00",
    )
    consensus = result["valuation_hub"]["consensus"]
    sector_target = result["valuation_hub"]["sector_weighted_valuation"]["target_price"]
    assert consensus["mean_target_price"] == 120
    assert consensus["median_target_price"] == 110
    assert consensus["decision_target_price"] == pytest.approx(0.3 * 120 + 0.3 * 110 + 0.4 * sector_target)
    assert consensus["consensus_basis"] == "mean_median_sector_weighted"
    assert consensus["component_weights"] == {"mean": 0.3, "median": 0.3, "sector_weighted": 0.4}
    assert result["score_card"]["mean_score"] == pytest.approx(16.0)
    assert result["score_card"]["median_score"] == pytest.approx(14.0)
    assert result["score_card"]["sector_weighted_score"] == pytest.approx(16.0)
    assert result["score_card"]["combined_score"] == pytest.approx(15.4)
    assert result["score_card"]["adjusted_score"] == pytest.approx(12.32)
    assert [row["name"] for row in result["valuation_hub"]["method_blocks"]].count(MODEL_NAME) == 1
    # Idempotent replacement, never a second derived row.
    again = apply_to_dashboard(result, sector="Technology", sector_source="tickers", provenance="backfill")
    assert [row["name"] for row in again["valuation_hub"]["method_blocks"]].count(MODEL_NAME) == 1


def test_consensus_renormalizes_when_median_is_unavailable() -> None:
    dashboard = _dashboard()
    dashboard["valuation_hub"]["consensus"]["median_target_price"] = None
    dashboard["valuation_hub"]["method_tabs"] = dashboard["valuation_hub"]["method_tabs"][:1]
    dashboard["valuation_hub"]["method_blocks"] = dashboard["valuation_hub"]["method_blocks"][:1]
    dashboard["score_card"]["median_investment_amount"] = None
    result = apply_to_dashboard(dashboard, sector="Technology", sector_source="test", provenance="generated")
    weights = result["valuation_hub"]["consensus"]["component_weights"]
    assert weights == pytest.approx({"mean": 3 / 7, "sector_weighted": 4 / 7})
    assert result["valuation_hub"]["consensus"]["consensus_basis"] == "mean_sector_weighted"
