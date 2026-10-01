from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "sector_weighted_backfill",
    ROOT / "scripts" / "db" / "backfill_sector_weighted_valuation.py",
)
assert SPEC and SPEC.loader
BACKFILL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKFILL)


def _complete_dashboard() -> dict:
    return {
        "valuation_hub": {
            "sector_weighted_valuation": {"policy_version": BACKFILL.POLICY_VERSION},
            "consensus": {
                "sector_weighted_target_price": 120,
                "decision_target_price": 115,
                "component_weights": {"mean": 0.3, "median": 0.3, "sector_weighted": 0.4},
                "configured_component_weights": {"mean": 0.3, "median": 0.3, "sector_weighted": 0.4},
                "consensus_basis": "mean_median_sector_weighted",
            },
        },
        "score_card": {
            "mean_target_return_pct": 10,
            "median_target_return_pct": 12,
            "sector_weighted_target_return_pct": 15,
            "mean_score": 8,
            "median_score": 9,
            "sector_weighted_score": 11,
            "combined_score": 9.5,
            "adjusted_score": 8.7,
            "component_weights": {"mean": 0.3, "median": 0.3, "sector_weighted": 0.4},
            "allocation_component_weights": {"mean": 0.3, "median": 0.3, "sector_weighted": 0.4},
            "configured_component_weights": {"mean": 0.3, "median": 0.3, "sector_weighted": 0.4},
            "consensus_basis": "mean_median_sector_weighted",
        },
    }


def test_current_policy_requires_the_complete_consensus_contract() -> None:
    dashboard = _complete_dashboard()
    assert BACKFILL._already_current(dashboard) is True

    del dashboard["score_card"]["mean_score"]
    assert BACKFILL._already_current(dashboard) is False


def test_old_or_partial_policy_is_not_treated_as_current() -> None:
    assert BACKFILL._already_current({}) is False
    dashboard = _complete_dashboard()
    dashboard["valuation_hub"]["sector_weighted_valuation"]["policy_version"] = "sector-weighted-v0"
    assert BACKFILL._already_current(dashboard) is False
