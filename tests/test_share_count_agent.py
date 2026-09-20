import json

from ai_hedge.share_count_agent import (
    apply_share_count_resolution,
    resolve_share_count,
)


def _filings():
    return {
        "10-K": {
            "source": "SEC",
            "date": "2026-08-01",
            "text": (
                "Cover Page\n\n"
                "As of July 31, 2026, there were 42,274,119 ordinary shares outstanding.\n"
                "The company has one class of ordinary shares."
            ),
        }
    }


def _official_response(**_kwargs):
    return json.dumps(
        {
            "selected_shares_outstanding": 42_274_119,
            "source_type": "official_filing",
            "basis": "Latest 10-K cover page total ordinary shares",
            "as_of_date": "2026-07-31",
            "evidence_excerpt": "As of July 31, 2026, there were 42,274,119 ordinary shares outstanding.",
            "calculation": "",
            "confidence": "High",
        }
    )


def test_resolve_share_count_accepts_total_count_with_verbatim_filing_evidence():
    result = resolve_share_count(
        ticker="TEST",
        info_dict={"impliedSharesOutstanding": 40_000_000, "marketCap": 400_000_000, "currentPrice": 10},
        files_dict=_filings(),
        current_value=40_000_000,
        api_key="test-key",
        llm_call=_official_response,
    )

    assert result["status"] == "verified"
    assert result["source_type"] == "official_filing"
    assert result["selected_shares_outstanding"] == 42_274_119
    assert result["fallback_used"] is False


def test_resolve_share_count_rejects_number_not_supported_by_quoted_evidence():
    def unsupported_number(**_kwargs):
        payload = json.loads(_official_response())
        payload["selected_shares_outstanding"] = 99_000_000
        return json.dumps(payload)

    result = resolve_share_count(
        ticker="TEST",
        info_dict={"impliedSharesOutstanding": 40_000_000, "marketCap": 400_000_000, "currentPrice": 10},
        files_dict=_filings(),
        current_value=40_000_000,
        api_key="test-key",
        llm_call=unsupported_number,
    )

    assert result["status"] == "fallback"
    assert result["selected_shares_outstanding"] == 40_000_000
    assert result["basis"] == "current_valuation_denominator"


def test_resolve_share_count_without_filings_preserves_current_provider_denominator():
    result = resolve_share_count(
        ticker="TEST",
        info_dict={"impliedSharesOutstanding": 40_000_000, "marketCap": 400_000_000, "currentPrice": 10},
        files_dict={},
        current_value=40_000_000,
        api_key="test-key",
    )

    assert result["status"] == "fallback"
    assert result["selected_shares_outstanding"] == 40_000_000
    assert result["basis"] == "current_valuation_denominator"


def test_apply_share_count_resolution_rebuilds_market_cap_and_ev_from_selected_denominator():
    variables = apply_share_count_resolution(
        {
            "shares_outstanding": 40,
            "price": 10,
            "market_cap": 400,
            "total_debt": 30,
            "total_cash": 20,
        },
        {
            "selected_shares_outstanding": 42,
            "status": "verified",
            "source_type": "official_filing",
        },
    )

    assert variables["shares_outstanding"] == 42
    assert variables["market_cap"] == 420
    assert variables["ev"] == 430
    assert variables["ev_source"] == "statement_net_debt_verified_shares"
