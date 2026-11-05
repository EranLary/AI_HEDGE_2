from io import StringIO
from unittest.mock import patch

import pandas as pd

from ai_hedge import legacy_port


class _FakeTicker:
    def __init__(self, price):
        self.info = {"regularMarketPrice": price}


def test_currency_symbol_candidates_use_dynamic_iso_fallback():
    assert legacy_port._currency_symbol_candidates("KZT")[:2] == ["KZT=X", "USDKZT=X"]


def test_find_currency_uses_dynamic_iso_pair_when_not_in_static_map():
    seen = []

    def fake_ticker(symbol):
        seen.append(symbol)
        return _FakeTicker(470.25 if symbol == "KZT=X" else None)

    with patch("ai_hedge.legacy_port.yf.Ticker", side_effect=fake_ticker):
        rate = legacy_port.find_currency("KZT")

    assert rate == 470.25
    assert seen == ["KZT=X"]


def test_find_currency_keeps_minor_unit_multiplier():
    with patch("ai_hedge.legacy_port.yf.Ticker", return_value=_FakeTicker(3.7)):
        assert legacy_port.find_currency("ILA") == 370


def test_financial_csv_converts_money_but_never_share_counts():
    frame = pd.DataFrame(
        {
            "2026-06-30": {
                "Total Revenue": 1_685_889_024,
                "Basic Average Shares": 25_000_000,
                "Diluted Average Shares": 25_000_000,
                "Diluted EPS": 1.64,
            }
        }
    )

    rendered = legacy_port.df_to_llm_csv(frame, scale_abs_gt=3.1091)
    parsed = pd.read_csv(StringIO(rendered))

    assert parsed.loc[0, "Total Revenue"] == round(1_685_889_024 / 3.1091, 2)
    assert parsed.loc[0, "Basic Average Shares"] == 25_000_000
    assert parsed.loc[0, "Diluted Average Shares"] == 25_000_000
    assert parsed.loc[0, "Diluted EPS"] == 1.64
