from scripts import screener_sp500_profiles as screener


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
