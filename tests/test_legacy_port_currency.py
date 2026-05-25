from unittest.mock import patch

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
