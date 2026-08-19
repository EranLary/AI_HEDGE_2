from ai_hedge import legacy_port


def _variables_for(info):
    return legacy_port.get_variables(
        "TEST",
        info,
        {
            "source": "yfinance_statement_tables",
            "total_assets": 1000,
            "total_equity": 400,
            "total_cash": 20,
            "total_debt": 30,
            "current_ratio": 2,
            "equity_to_assets": 0.4,
            "revenue": 100,
            "net_income": 10,
            "free_cashflow": 8,
        },
    )


def test_get_variables_prefers_implied_shares_outstanding():
    variables = _variables_for(
        {
            "impliedSharesOutstanding": 123,
            "sharesOutstanding": 456,
            "currentPrice": 10,
            "marketCap": 4560,
            "bookValue": 2,
        }
    )

    assert variables["shares_outstanding"] == 123


def test_get_variables_falls_back_to_shares_outstanding_when_implied_missing():
    variables = _variables_for(
        {
            "impliedSharesOutstanding": None,
            "sharesOutstanding": 272083008,
            "currentPrice": 31.15,
            "marketCap": None,
            "bookValue": 2,
        }
    )

    assert variables["shares_outstanding"] == 272083008
    assert variables["market_cap"] == 31.15 * 272083008


def test_get_variables_derives_shares_from_market_cap_and_price():
    variables = _variables_for(
        {
            "impliedSharesOutstanding": None,
            "sharesOutstanding": None,
            "currentPrice": 25,
            "marketCap": 2500,
            "bookValue": 2,
        }
    )

    assert variables["shares_outstanding"] == 100


def test_get_variables_uses_statement_metrics_not_provider_financial_summary():
    variables = _variables_for(
        {
            "sharesOutstanding": 100,
            "currentPrice": 10,
            "marketCap": 1000,
            "totalCash": 900,
            "totalDebt": 800,
            "totalRevenue": 700,
            "netIncomeToCommon": 600,
            "freeCashflow": 500,
            "bookValue": 400,
            "currentRatio": 99,
        }
    )

    assert variables["ev"] == 1010
    assert variables["ev_source"] == "statement_net_debt"
    assert variables["revenue"] == 100
    assert variables["net_income"] == 10
    assert variables["free_cashflow"] == 8
    assert variables["current_ratio"] == 2
    assert variables["Equity"] == 400


def test_recalculate_derived_metrics_preserves_provider_multiples():
    info = {
        "currentPrice": 10,
        "sharesOutstanding": 100,
        "marketCap": 999,
        "trailingPE": 8.5,
        "priceToBook": 1.2,
        "priceToSalesTrailing12Months": 4.1,
        "enterpriseValue": 1_500,
        "enterpriseToRevenue": 5.2,
        "enterpriseToEbitda": 7.3,
        "totalRevenue": 1,
        "totalDebt": 900,
        "totalCash": 800,
        "netIncomeToCommon": 1,
    }

    result = legacy_port.recalculate_derived_metrics(info)

    assert result["marketCap"] == 1_000
    assert result["trailingPE"] == 8.5
    assert result["priceToBook"] == 1.2
    assert result["priceToSalesTrailing12Months"] == 4.1
    assert result["enterpriseValue"] == 1_500
    assert result["enterpriseToRevenue"] == 5.2
    assert result["enterpriseToEbitda"] == 7.3
