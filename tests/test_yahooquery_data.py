from ai_hedge.yahooquery_data import _company_profile_payload, _live_quote_payload


def test_live_quote_payload_keeps_market_cap_and_enterprise_value_in_provider_currency():
    payload = _live_quote_payload(
        {
            "symbol": "AXN.TA",
            "currency": "ILA",
            "financialCurrency": "ILS",
            "currentPrice": 724.6,
            "sharesOutstanding": 18277780,
            "marketCap": 132440792,
            "enterpriseValue": 110804120,
            "longName": "Ignored",
        }
    )

    assert payload == {
        "symbol": "AXN.TA",
        "currency": "ILA",
        "financialCurrency": "ILS",
        "currentPrice": 724.6,
        "sharesOutstanding": 18277780,
        "marketCap": 132440792,
        "enterpriseValue": 110804120,
    }


def test_company_profile_payload_uses_same_yahooquery_asset_profile_fields_as_screeners():
    payload = _company_profile_payload(
        {
            "AAPL": {
                "sector": "Technology",
                "industry": "Consumer Electronics",
                "longBusinessSummary": "Not part of the Info contract.",
            }
        },
        "AAPL",
    )

    assert payload == {
        "sector": "Technology",
        "industry": "Consumer Electronics",
        "source": "yahooquery.asset_profile",
    }
