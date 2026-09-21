from __future__ import annotations

from ai_hedge import dashboard


def _payload(monkeypatch, resolution):
    monkeypatch.setattr(dashboard, "_compute_price_performance_pct", lambda _ticker: {})
    return dashboard.build_dashboard_payload(
        ticker="TEST",
        info_dict={"info": {"shortName": "Test Company", "currency": "USD"}},
        financial_dict={},
        variables_dict={
            "price": 10,
            "market_cap": 422_741_190,
            "shares_outstanding": 42_274_119,
            "share_count_resolution": resolution,
        },
        final_dict={
            "Prices": {"Current": 10, "Mean": [12]},
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


def test_dashboard_exposes_changed_share_count_resolution(monkeypatch) -> None:
    payload = _payload(
        monkeypatch,
        {
            "status": "verified",
            "selected_shares_outstanding": 42_274_119,
            "source_type": "official_filing",
            "basis": "Total ordinary shares in the latest filing",
            "as_of_date": "2026-06-30",
            "evidence_excerpt": "42,274,119 ordinary shares were outstanding.",
            "calculation": "",
            "confidence": "High",
            "fallback_used": False,
            "validation_note": "Accepted after deterministic evidence validation.",
            "provider_candidates": {
                "current_valuation_denominator": 40_000_000,
                "provider_implied_shares": 40_000_000,
                "market_cap_div_current_price": 39_999_999.8,
                "ignored_candidate": 1,
            },
        },
    )

    summary = payload["header"]["share_count_resolution"]
    assert summary["selected_shares_outstanding"] == 42_274_119
    assert summary["original_yahoo_shares"] == 40_000_000
    assert summary["changed_from_yahoo"] is True
    assert summary["source_type"] == "official_filing"
    assert summary["provider_candidates"] == {
        "current_valuation_denominator": 40_000_000,
        "provider_implied_shares": 40_000_000,
        "market_cap_div_current_price": 39_999_999.8,
    }


def test_dashboard_marks_matching_share_count_as_unchanged(monkeypatch) -> None:
    payload = _payload(
        monkeypatch,
        {
            "status": "fallback",
            "selected_shares_outstanding": 42_274_119,
            "source_type": "provider_fallback",
            "fallback_used": True,
            "provider_candidates": {"current_valuation_denominator": 42_274_119},
        },
    )

    assert payload["header"]["share_count_resolution"]["changed_from_yahoo"] is False
