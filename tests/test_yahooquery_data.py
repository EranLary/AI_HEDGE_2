import sys
from types import SimpleNamespace

import pandas as pd

from ai_hedge import yahooquery_data
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


def test_live_summary_snapshot_skips_asset_profile_request(monkeypatch):
    class FakeTicker:
        valuation_measures = pd.DataFrame()
        financial_data = {}
        earning_history = pd.DataFrame()
        corporate_events = pd.DataFrame()
        share_purchase_activity = {}

        @property
        def asset_profile(self):
            raise AssertionError("asset_profile must not be loaded by the Summary live path")

    monkeypatch.setitem(sys.modules, "yahooquery", SimpleNamespace(Ticker=lambda _symbol: FakeTicker()))
    monkeypatch.setattr(yahooquery_data, "_fetch_live_quote", lambda _symbol: {})

    payload = yahooquery_data.fetch_yahooquery_snapshot(
        "AAPL",
        include_company_profile=False,
    )

    assert payload["status"] == "success"
    assert "company_profile" not in payload
