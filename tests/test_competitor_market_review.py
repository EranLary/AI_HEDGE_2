import json

import pandas as pd

from ai_hedge import competitor_market_review as cmr


def test_parse_json_object_handles_fenced_response():
    parsed = cmr.parse_json_object(
        'Here you go:\n```json\n{"name_of_market":"AI chips","competitors":[{"ticker":"AMD"}]}\n```'
    )
    assert parsed["name_of_market"] == "AI chips"
    assert parsed["competitors"][0]["ticker"] == "AMD"


def test_normalize_competitors_excludes_original_and_duplicates():
    payload = {
        "competitors": [
            {"ticker": "AAPL", "company_name": "Apple"},
            {"ticker": "MSFT", "company_name": "Microsoft"},
            {"ticker": "msft", "company_name": "Microsoft duplicate"},
            {"symbol": "GOOG", "name": "Alphabet"},
        ]
    }
    out = cmr.normalize_competitors(payload, original_ticker="AAPL")
    assert [row["ticker"] for row in out] == ["MSFT", "GOOG"]
    assert out[0]["rank"] == 1


def test_normalize_competitors_keeps_more_than_five_and_adds_israeli_suffix():
    payload = {
        "competitors": [
            {"ticker": "ONE", "country": "Israel", "company_name": "One"},
            {"ticker": "TWO.TA", "country": "Israel", "company_name": "Two"},
            {"ticker": "US1", "country": "United States", "company_name": "US 1"},
            {"ticker": "US2", "country": "United States", "company_name": "US 2"},
            {"ticker": "US3", "country": "United States", "company_name": "US 3"},
            {"ticker": "US4", "country": "United States", "company_name": "US 4"},
        ]
    }
    out = cmr.normalize_competitors(payload, original_ticker="MAIN")
    assert [row["ticker"] for row in out] == ["ONE.TA", "TWO.TA", "US1", "US2", "US3", "US4"]


def test_discovery_prompt_allows_more_than_five_and_israeli_suffix():
    prompt = cmr.build_discovery_prompt("TEST.TA", {"country": "Israel", "longBusinessSummary": "software"})
    assert "okay to return more than 5" in prompt
    assert "top 5 ranked companies" in prompt
    assert ".TA" in prompt
    assert "United States" in prompt


def test_collect_competitor_context_caps_to_five_and_uses_info_engine():
    discovery = {
        "competitors": [
            {"ticker": f"T{i}", "company_name": f"Company {i}"}
            for i in range(1, 8)
        ]
    }
    info_calls = []
    annual_calls = []

    def fake_info(ticker):
        info_calls.append(ticker)
        return {
            "info": {
                "shortName": f"{ticker} Inc",
                "marketCap": 123,
                "financial_currency_to_USD": 2,
                "longBusinessSummary": "summary",
            }
        }

    def fake_annual(ticker, info_data):
        annual_calls.append((ticker, info_data["info"]["financial_currency_to_USD"]))
        return "### Annual Income Statement\n```csv\nRevenue\n```\n\n"

    out = cmr.collect_competitor_context(
        discovery=discovery,
        original_ticker="MAIN",
        info_fetcher=fake_info,
        annual_table_fetcher=fake_annual,
    )

    assert [row["ticker"] for row in out] == ["T1", "T2", "T3", "T4", "T5"]
    assert info_calls == ["T1", "T2", "T3", "T4", "T5"]
    assert annual_calls == [("T1", 2), ("T2", 2), ("T3", 2), ("T4", 2), ("T5", 2)]
    assert out[0]["info"]["marketCap"] == 123


def test_collect_competitor_context_retries_invalid_ticker_then_skips():
    discovery = {
        "competitors": [
            {"ticker": "BAD", "company_name": "Bad"},
            {"ticker": "GOOD", "company_name": "Good"},
        ]
    }
    calls = []

    def fake_info(ticker):
        calls.append(ticker)
        if ticker == "BAD":
            return {"info": "Not available"}
        return {"info": {"shortName": "Good Inc", "symbol": "GOOD", "financial_currency_to_USD": 1}}

    def fake_annual(ticker, _info_data):
        return f"### Annual Income Statement\n```csv\n{ticker}\n```\n\n"

    out = cmr.collect_competitor_context(
        discovery=discovery,
        original_ticker="MAIN",
        info_fetcher=fake_info,
        annual_table_fetcher=fake_annual,
        retries=3,
    )

    assert [row["ticker"] for row in out] == ["GOOD"]
    assert calls == ["BAD", "BAD", "BAD", "GOOD"]


def test_default_annual_table_fetcher_uses_financials_and_csv_engine(monkeypatch):
    calls = {}

    class FakeTicker:
        def __init__(self, ticker):
            calls["ticker"] = ticker

        @property
        def financials(self):
            calls["financials"] = True
            return pd.DataFrame({"2025": [100]}, index=["Revenue"])

        @property
        def balance_sheet(self):
            raise AssertionError("balance sheet should not be fetched")

        @property
        def cashflow(self):
            raise AssertionError("cashflow should not be fetched")

    def fake_csv(df, scale):
        calls["scale"] = scale
        return "Reporting_Period,Revenue\n2025,50"

    monkeypatch.setattr(cmr.yf, "Ticker", FakeTicker)
    monkeypatch.setattr("ai_hedge.legacy_port.df_to_llm_csv", fake_csv)

    table = cmr._default_annual_table_fetcher("TEST", {"info": {"financial_currency_to_USD": 2}})

    assert calls == {"ticker": "TEST", "financials": True, "scale": 2.0}
    assert "Annual Income Statement" in table
    assert "Reporting_Period,Revenue" in table


def test_result_degrades_to_unavailable_and_writes_sidecar(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)

    def fail_run(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(cmr, "run_competitor_market_review", fail_run)
    header, body = cmr.competitor_market_review_result("TEST", {"info": {}})

    assert header == cmr.CONTEXT_HEADER
    assert "unavailable" in body
    payload = json.loads((tmp_path / cmr.SIDECAR_FILENAME).read_text(encoding="utf-8"))
    assert payload["status"] == "unavailable"
    assert "boom" in payload["error"]
