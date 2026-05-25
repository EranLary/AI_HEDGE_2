from ai_hedge import legacy_port


def _variables_for(info):
    return legacy_port.get_variables(
        "TEST",
        info,
        {"index": ["Total Assets"], "values": [[1000]]},
        {},
        {"totalRevenue": 100, "netIncomeToCommon": 10},
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
