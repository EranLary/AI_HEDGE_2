from ai_hedge.provider_data_policy import (
    QUARANTINED_FINANCIAL_INFO_KEYS,
    safe_company_profile,
    valuation_only_yahooquery,
)


def test_safe_company_profile_uses_explicit_context_allowlists():
    info = {
        "shortName": "RIT 1",
        "symbol": "RIT1.TA",
        "longBusinessSummary": "Real-estate investment company.",
        "currentPrice": 25,
        "marketCap": 2_500,
        "trailingPE": 8.5,
        "enterpriseToRevenue": 4.2,
        "revenueGrowth": -0.128,
        "grossMargins": 0.94763,
        "totalRevenue": 509_428_000,
        "unknownProviderField": "do not leak",
    }

    profile = safe_company_profile(info)
    market_profile = safe_company_profile(info, include_market_context=True)
    valuation_profile = safe_company_profile(
        info,
        include_market_context=True,
        include_valuation_context=True,
    )

    assert profile == {
        "shortName": "RIT 1",
        "symbol": "RIT1.TA",
        "longBusinessSummary": "Real-estate investment company.",
    }
    assert market_profile["currentPrice"] == 25
    assert market_profile["marketCap"] == 2_500
    assert "trailingPE" not in market_profile
    assert valuation_profile["trailingPE"] == 8.5
    assert valuation_profile["enterpriseToRevenue"] == 4.2
    assert not QUARANTINED_FINANCIAL_INFO_KEYS.intersection(valuation_profile)
    assert "unknownProviderField" not in valuation_profile


def test_valuation_only_yahooquery_drops_financial_data_and_unknown_columns():
    snapshot = {
        "status": "success",
        "ticker": "RIT1.TA",
        "generated_at": "2026-08-18T00:00:00Z",
        "valuation_measures": {
            "rows": [
                {
                    "asOfDate": "2026-06-30",
                    "periodType": "TTM",
                    "PeRatio": 8.5,
                    "PsRatio": 4.1,
                    "revenueGrowth": -0.128,
                }
            ],
            "columns": ["asOfDate", "periodType", "PeRatio", "PsRatio", "revenueGrowth"],
            "latest": {"periodType": "TTM", "PeRatio": 8.5, "grossMargins": 0.94},
            "latest_by_period": {
                "TTM": {"periodType": "TTM", "PeRatio": 8.5, "totalRevenue": 1}
            },
            "recent_average": {"PeRatio": 8.1, "profitMargins": 0.8},
        },
        "live_quote": {"currentPrice": 25, "marketCap": 2_500, "totalDebt": 99},
        "financial_data": {"revenueGrowth": -0.128, "grossMargins": 0.94},
        "earnings_surprise": {"rows": [{"epsActual": 1}]},
    }

    clean = valuation_only_yahooquery(snapshot)

    assert clean["valuation_measures"]["rows"] == [
        {
            "asOfDate": "2026-06-30",
            "periodType": "TTM",
            "PeRatio": 8.5,
            "PsRatio": 4.1,
        }
    ]
    assert clean["valuation_measures"]["columns"] == [
        "asOfDate",
        "periodType",
        "PeRatio",
        "PsRatio",
    ]
    assert clean["valuation_measures"]["latest"] == {"periodType": "TTM", "PeRatio": 8.5}
    assert clean["live_quote"] == {"currentPrice": 25, "marketCap": 2_500}
    assert "financial_data" not in clean
    assert "earnings_surprise" not in clean
