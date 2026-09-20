from __future__ import annotations

import pytest

from ai_hedge import dashboard


def test_dashboard_scores_and_allocates_from_equal_mean_median_views(monkeypatch) -> None:
    monkeypatch.setattr(dashboard, "_compute_price_performance_pct", lambda _ticker: {})

    payload = dashboard.build_dashboard_payload(
        ticker="TEST",
        info_dict={"info": {"shortName": "Test Company", "currency": "USD"}},
        financial_dict={},
        variables_dict={"price": 100, "market_cap": 10_000, "shares_outstanding": 100},
        final_dict={
            "Prices": {
                "Current": 100,
                "Mean": [130, 110, 140],
                "Median": [110, 110, 140],
                "STD": 0,
                "CV": 0,
                "LMIL": [2.5, 0],
                "LMIL Mean Investment": 10_000,
                "LMIL Median Investment": -5_000,
                "LMIL Decision Investment": 2_500,
            },
            "Revenue": {"Current": 1, "Mean": [2]},
            "Net Income": {"Current": 1, "Mean": [2]},
        },
        explain_payload={"methods": {}, "aggregate_targets": {}, "aggregate_investments": {}},
        analysis_text="",
        sec_short_text="",
        qualitative_sections={
            "executive_summary_markdown": "",
            "bull_case_reasons": [],
            "bear_case_reasons": [],
            "main_thesis_questions": [],
            "watchlist_kpis": [],
            "key_insights": [],
            "bull_insights": [],
            "documents": {},
            "source": "test",
        },
        artifacts={},
        enable_llm_extractions=False,
    )

    consensus = payload["valuation_hub"]["consensus"]
    score = payload["score_card"]
    assert consensus["mean_target_price"] == 130
    assert consensus["median_target_price"] == 110
    assert consensus["decision_target_price"] == 120
    assert consensus["consensus_basis"] == "mean_median"
    assert score["mean_score"] == pytest.approx(22)
    assert score["median_score"] == pytest.approx(4)
    assert score["combined_score"] == pytest.approx(13)
    assert score["position_size_pct_of_notional"] == pytest.approx(2.5)
    assert score["adjusted_score"] == pytest.approx(13)
    assert score["consensus_basis"] == "mean_median"


def test_dashboard_falls_back_entirely_to_mean_without_complete_median(monkeypatch) -> None:
    monkeypatch.setattr(dashboard, "_compute_price_performance_pct", lambda _ticker: {})
    payload = dashboard.build_dashboard_payload(
        ticker="TEST",
        info_dict={"info": {"shortName": "Test Company", "currency": "USD"}},
        financial_dict={},
        variables_dict={"price": 100},
        final_dict={
            "Prices": {
                "Current": 100,
                "Mean": [130],
                "Median": [110],
                "CV": 0,
                "LMIL": [10, 0],
                "LMIL Mean Investment": 10_000,
            },
            "Revenue": {},
            "Net Income": {},
        },
        explain_payload={"methods": {}, "aggregate_targets": {}, "aggregate_investments": {}},
        analysis_text="",
        sec_short_text="",
        qualitative_sections={"documents": {}, "source": "test"},
        artifacts={},
        enable_llm_extractions=False,
    )
    consensus = payload["valuation_hub"]["consensus"]
    score = payload["score_card"]
    assert consensus["median_target_price"] is None
    assert consensus["decision_target_price"] == 130
    assert consensus["consensus_basis"] == "mean_only"
    assert score["decision_investment_amount"] == 10_000
    assert score["median_score"] is None
    assert score["consensus_basis"] == "mean_only"
