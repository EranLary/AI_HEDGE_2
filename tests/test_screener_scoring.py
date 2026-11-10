from scripts import screener_sp500_profiles as screener
from ai_hedge import legacy_port


def _analysis(*, pb_ratio: float) -> dict[str, float]:
    return {
        "peRatio": 10,
        "pbRatio": pb_ratio,
        "evToEbitda": 10,
        "evToRevenue": 10,
        "evToFcf": 10,
    }


def test_screener_pb_sector_policy_matches_full_valuation_gate():
    assert screener.PB_ELIGIBLE_SECTORS == legacy_port.PB_ELIGIBLE_SECTORS


def test_ineligible_sector_excludes_pb_and_reweights_other_valuation_metrics():
    configs = screener._valuation_configs_for_sector("Technology")

    assert "pbRatio" not in configs
    assert set(configs) == {"peRatio", "evToEbitda", "evToRevenue", "evToFcf"}
    assert {config["weight"] for config in configs.values()} == {0.25}
    assert sum(config["weight"] for config in configs.values()) == 1.0


def test_eligible_sector_keeps_pb_at_current_weight_with_normalized_name():
    configs = screener._valuation_configs_for_sector("  FINANCIAL   SERVICES ")

    assert set(configs) == set(screener.VALUATION_METRIC_KEYS)
    assert {config["weight"] for config in configs.values()} == {0.20}
    assert sum(config["weight"] for config in configs.values()) == 1.0


def test_pb_changes_score_only_for_eligible_sectors():
    rows = [
        {
            "sector": "Technology",
            "industry": "Software",
            "analysis": _analysis(pb_ratio=1),
        },
        {
            "sector": "Technology",
            "industry": "Software",
            "analysis": _analysis(pb_ratio=100),
        },
        {
            "sector": "Financial Services",
            "industry": "Banks - Regional",
            "analysis": _analysis(pb_ratio=1),
        },
        {
            "sector": "Financial Services",
            "industry": "Banks - Regional",
            "analysis": _analysis(pb_ratio=100),
        },
    ]

    screener._calculate_scores(rows)

    assert rows[0]["valuation_score"] == 50.0
    assert rows[1]["valuation_score"] == 50.0
    assert rows[0]["valuation_coverage"] == 100.0
    assert rows[1]["valuation_coverage"] == 100.0
    assert rows[2]["valuation_score"] == 55.0
    assert rows[3]["valuation_score"] == 45.0


def test_peer_blend_weights_follow_industry_size_thresholds():
    assert screener._peer_blend_weights(4) == {"sector": 0.70, "industry": 0.30}
    assert screener._peer_blend_weights(5) == {"sector": 0.50, "industry": 0.50}
    assert screener._peer_blend_weights(15) == {"sector": 0.50, "industry": 0.50}
    assert screener._peer_blend_weights(16) == {"sector": 0.30, "industry": 0.70}


def test_blended_percentile_uses_industry_size_policy():
    sector_values = {"Technology": {"peRatio": [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}}
    industry_values = {"Software": {"peRatio": [10, 20, 30, 40]}}

    small_industry_score = screener._blended_percentile(
        "peRatio",
        30,
        "higher",
        "Technology",
        "Software",
        sector_values,
        industry_values,
        {"Software": 4},
    )
    medium_industry_score = screener._blended_percentile(
        "peRatio",
        30,
        "higher",
        "Technology",
        "Software",
        sector_values,
        industry_values,
        {"Software": 5},
    )
    large_industry_score = screener._blended_percentile(
        "peRatio",
        30,
        "higher",
        "Technology",
        "Software",
        sector_values,
        industry_values,
        {"Software": 16},
    )

    assert small_industry_score == 36.25
    assert medium_industry_score == 43.75
    assert large_industry_score == 51.25
