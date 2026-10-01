from ai_hedge.company_profile import resolve_company_profile


def test_company_profile_prefers_analysis_info_used_by_valuation():
    profile = resolve_company_profile(
        {
            "info": {"sector": " Financial Services ", "industry": " Banks - Regional "},
            "yahooquery": {
                "company_profile": {
                    "sector": "Other sector",
                    "industry": "Other industry",
                }
            },
        }
    )

    assert profile == {
        "sector": "Financial Services",
        "industry": "Banks - Regional",
        "source": "yfinance.info",
    }


def test_company_profile_uses_field_level_yahooquery_fallback_without_overwriting_sector():
    profile = resolve_company_profile(
        {
            "info": {"sector": "Technology", "industry": ""},
            "yahooquery": {
                "company_profile": {
                    "sector": "Different sector",
                    "industry": "Software - Infrastructure",
                }
            },
        }
    )

    assert profile == {
        "sector": "Technology",
        "industry": "Software - Infrastructure",
        "source": "yfinance.info+yahooquery.asset_profile",
    }
