from __future__ import annotations

import pytest

from ai_hedge import legacy_port as legacy


class _FakeTicker:
    def __init__(self, outcome):
        self._outcome = outcome

    @property
    def info(self):
        if isinstance(self._outcome, Exception):
            raise self._outcome
        return self._outcome


def test_yfinance_info_retries_with_a_fresh_client_and_backoff(monkeypatch) -> None:
    outcomes = [RuntimeError("HTTP 429"), TimeoutError("timed out"), {"shortName": "Apple"}]
    clients = []
    sleeps = []

    def fake_ticker(_ticker):
        client = _FakeTicker(outcomes[len(clients)])
        clients.append(client)
        return client

    monkeypatch.setattr(legacy.yf, "Ticker", fake_ticker)
    monkeypatch.setattr(legacy.random, "uniform", lambda _low, high: high)
    monkeypatch.setattr(legacy.time, "sleep", sleeps.append)

    client, info = legacy._fetch_yfinance_info_with_retry("aapl")

    assert client is clients[-1]
    assert info == {"shortName": "Apple"}
    assert len(clients) == 3
    assert sleeps == [2.5, 5.0]


def test_yfinance_info_failure_is_explicit_and_never_returns_a_string(monkeypatch) -> None:
    monkeypatch.setattr(legacy.yf, "Ticker", lambda _ticker: _FakeTicker("Not available"))
    monkeypatch.setattr(legacy.time, "sleep", lambda _delay: None)

    with pytest.raises(legacy.YahooInfoUnavailableError) as raised:
        legacy._fetch_yfinance_info_with_retry("ABNB", base_delay_seconds=0)

    message = str(raised.value)
    assert "Yahoo info unavailable for ABNB after 3 attempts" in message
    assert "expected a non-empty dict" in message
