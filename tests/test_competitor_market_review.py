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


def test_build_original_company_context_uses_info_and_annual_income_statement():
    annual_calls = []

    def fake_annual(ticker, info_data):
        annual_calls.append((ticker, info_data["info"]["financial_currency_to_USD"]))
        return "### Annual Income Statement\n```csv\nRevenue,Net Income\n100,30\n```\n\n"

    context = cmr.build_original_company_context(
        ticker="CHKP",
        info_dict={
            "info": {
                "shortName": "Check Point",
                "symbol": "CHKP",
                "marketCap": 123,
                "financial_currency_to_USD": 1,
                "longBusinessSummary": "Cybersecurity platform.",
            }
        },
        annual_table_fetcher=fake_annual,
    )

    assert annual_calls == [("CHKP", 1)]
    assert context["ticker"] == "CHKP"
    assert context["company_name"] == "Check Point"
    assert context["info"]["marketCap"] == 123
    assert "Revenue,Net Income" in context["annual_financials"]


def test_build_market_return_comparison_includes_original_and_competitors(monkeypatch):
    downloads = []

    def fake_download(ticker, **kwargs):
        downloads.append((ticker, kwargs["period"], kwargs["interval"]))
        if ticker == "BAD":
            return pd.DataFrame()
        return pd.DataFrame(
            {"Close": [10.0, 11.0, 12.0]},
            index=pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"]),
        )

    monkeypatch.setattr(cmr.yf, "download", fake_download)

    payload = cmr.build_market_return_comparison(
        original_company={"ticker": "MAIN", "company_name": "Main Co"},
        competitors=[
            {"ticker": "PEER", "company_name": "Peer Co"},
            {"ticker": "BAD", "company_name": "Bad Co"},
            {"ticker": "PEER", "company_name": "Duplicate"},
        ],
    )

    assert payload["status"] == "success"
    assert [row["ticker"] for row in payload["series"]] == ["MAIN", "PEER"]
    assert payload["series"][0]["prices"][0] == {"date": "2024-01-02", "close": 10.0}
    assert downloads == [("MAIN", "5y", "1d"), ("PEER", "5y", "1d"), ("BAD", "5y", "1d")]


def test_normalize_price_history_for_ta_rescales_persistent_upward_unit_switch():
    rows = [
        {"date": "2024-01-01", "close": 14.8},
        {"date": "2024-01-02", "close": 1452.0},
        {"date": "2024-01-03", "close": 1460.0},
        {"date": "2024-01-04", "close": 1471.0},
    ]

    normalized = cmr.normalize_price_history_for_ticker("TEST.TA", rows)

    assert [round(row["close"], 2) for row in normalized] == [14.8, 14.52, 14.6, 14.71]


def test_normalize_price_history_for_ta_rescales_persistent_downward_unit_switch():
    rows = [
        {"date": "2024-01-01", "close": 1480.0},
        {"date": "2024-01-02", "close": 14.52},
        {"date": "2024-01-03", "close": 14.6},
    ]

    normalized = cmr.normalize_price_history_for_ticker("TEST.TA", rows)

    assert [round(row["close"], 2) for row in normalized] == [1480.0, 1452.0, 1460.0]


def test_normalize_price_history_for_ta_ignores_unconfirmed_single_point_spike():
    rows = [
        {"date": "2024-01-01", "close": 14.8},
        {"date": "2024-01-02", "close": 1452.0},
        {"date": "2024-01-03", "close": 14.9},
        {"date": "2024-01-04", "close": 15.0},
    ]

    normalized = cmr.normalize_price_history_for_ticker("TEST.TA", rows)

    assert [row["close"] for row in normalized] == [14.8, 1452.0, 14.9, 15.0]


def test_normalize_price_history_does_not_rescale_non_ta_ticker():
    rows = [
        {"date": "2024-01-01", "close": 14.8},
        {"date": "2024-01-02", "close": 1452.0},
        {"date": "2024-01-03", "close": 1460.0},
    ]

    normalized = cmr.normalize_price_history_for_ticker("TEST", rows)

    assert normalized is rows


def test_review_prompt_requires_original_company_financial_comparison():
    prompt = cmr.build_review_prompt(
        {
            "ticker": "CHKP",
            "name_of_market": "Enterprise Cybersecurity",
            "original_company": {
                "ticker": "CHKP",
                "info": {"shortName": "Check Point", "marketCap": 123},
                "annual_financials": "### Annual Income Statement\n```csv\nRevenue\n```",
            },
            "competitors": [{"ticker": "PANW", "annual_financials": "### Annual Income Statement\nNot available"}],
        }
    )

    assert 'original company info_dict["info"]' in prompt
    assert "original company annual income-statement table" in prompt
    assert "Include the original company in the financial and strategic comparison" in prompt
    assert 'clear "-" cells when data is missing' in prompt
    assert '"original_company"' in prompt


def test_run_competitor_market_review_includes_original_company_payload(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        cmr,
        "discover_competitors",
        lambda **_kwargs: {"name_of_market": "Enterprise Cybersecurity", "competitors": []},
    )
    monkeypatch.setattr(cmr, "collect_competitor_context", lambda **_kwargs: [{"ticker": "PANW"}])
    monkeypatch.setattr(
        cmr,
        "build_original_company_context",
        lambda **_kwargs: {
            "ticker": "CHKP",
            "info": {"shortName": "Check Point"},
            "annual_financials": "### Annual Income Statement\n```csv\nRevenue\n```",
        },
    )
    monkeypatch.setattr(
        cmr,
        "build_market_return_comparison",
        lambda **_kwargs: {"status": "success", "series": [{"ticker": "CHKP", "prices": []}]},
    )

    def fake_generate_market_review(*, payload, api_key):
        captured["payload"] = payload
        captured["api_key"] = api_key
        return "review"

    monkeypatch.setattr(cmr, "generate_market_review", fake_generate_market_review)

    out = cmr.run_competitor_market_review(
        ticker="CHKP",
        info_dict={"info": {"shortName": "Check Point"}},
        api_key="key",
    )

    assert captured["payload"]["original_company"]["ticker"] == "CHKP"
    assert "Revenue" in captured["payload"]["original_company"]["annual_financials"]
    assert captured["payload"]["competitors"] == [{"ticker": "PANW"}]
    assert out["original_company"]["ticker"] == "CHKP"
    assert out["return_comparison"]["series"][0]["ticker"] == "CHKP"


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
