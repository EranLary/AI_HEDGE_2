from datetime import date

import pytest

from ai_hedge import portfolio_prices
from ai_hedge.portfolio_prices import build_usd_rows, fetch_price_bundle, fx_rate_to_usd


def test_fx_conversion_directions_for_ils_cad_and_gbp() -> None:
    assert fx_rate_to_usd("ILS", 4) == pytest.approx(0.25)
    assert fx_rate_to_usd("CAD", 1.25) == pytest.approx(0.8)
    assert fx_rate_to_usd("GBP", 1.3) == pytest.approx(1.3)
    assert fx_rate_to_usd("USD", None) == 1


def test_usd_rows_apply_historical_fx_without_using_future_quotes() -> None:
    rows = build_usd_rows(
        "TEST.TA",
        "ILS",
        {date(2026, 5, 3): 400, date(2026, 5, 4): 440},
        {date(2026, 5, 2): 4, date(2026, 5, 4): 4.4},
    )
    assert rows[0]["adjusted_close_usd"] == pytest.approx(1)
    assert rows[0]["fx_quote_date"] == "2026-05-02"
    assert rows[1]["adjusted_close_usd"] == pytest.approx(1)


def test_london_pence_are_normalized_to_pounds_before_fx() -> None:
    rows = build_usd_rows(
        "TEST.L",
        "GBP",
        {date(2026, 5, 4): 1_000},
        {date(2026, 5, 4): 1.25},
    )
    assert rows[0]["adjusted_close_local"] == 1_000
    assert rows[0]["adjusted_close_usd"] == pytest.approx(12.5)


def test_stale_fx_is_not_silently_filled() -> None:
    rows = build_usd_rows(
        "TEST.TO",
        "CAD",
        {date(2026, 5, 10): 100},
        {date(2026, 5, 4): 1.25},
        max_fx_age_days=5,
    )
    assert rows == []


def test_price_bundle_uses_the_requested_workspace_benchmark(monkeypatch, tmp_path) -> None:
    requested: list[str] = []

    def fake_history(symbol: str, start: date, end: date):
        del start, end
        requested.append(symbol)
        return {date(2026, 5, 4): 100.0}

    monkeypatch.setattr(portfolio_prices, "fetch_adjusted_closes", fake_history)
    result = fetch_price_bundle(
        [],
        start=date(2026, 5, 4),
        end=date(2026, 5, 4),
        repo_root=tmp_path,
        benchmark_symbol="QQQ",
        workers=1,
    )

    assert result["benchmark_symbol"] == "QQQ"
    assert set(result["assets"]) == {"QQQ"}
    assert requested == ["QQQ"]


def test_price_bundle_stitches_successor_prices_after_a_share_exchange(monkeypatch, tmp_path) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "portfolio_corporate_actions.json").write_text(
        """{
          "OLD.TA": {
            "successor_symbol": "NEW.TA",
            "effective_date": "2026-07-13",
            "shares_per_predecessor_share": 0.555,
            "source": "https://example.test/official-filing"
          }
        }""",
        encoding="utf-8",
    )

    def fake_history(symbol: str, start: date, end: date):
        del start, end
        return {
            "OLD.TA": {},
            "NEW.TA": {
                date(2026, 7, 12): 14_000.0,
                date(2026, 7, 13): 14_200.0,
            },
            "ILS=X": {date(2026, 7, 13): 4.0},
            "QQQ": {date(2026, 7, 13): 100.0},
        }[symbol]

    monkeypatch.setattr(portfolio_prices, "fetch_adjusted_closes", fake_history)
    result = fetch_price_bundle(
        [{"symbol": "OLD.TA", "currency": "ILS"}],
        start=date(2026, 7, 1),
        end=date(2026, 7, 20),
        repo_root=tmp_path,
        benchmark_symbol="QQQ",
        workers=1,
    )

    assert result["errors"] == []
    assert result["corporate_actions"] == [
        {
            "symbol": "OLD.TA",
            "successor_symbol": "NEW.TA",
            "effective_date": "2026-07-13",
            "shares_per_predecessor_share": 0.555,
            "source": "https://example.test/official-filing",
        }
    ]
    assert result["assets"]["OLD.TA"] == [
        {
            "symbol": "OLD.TA",
            "date": "2026-07-13",
            "adjusted_close_local": pytest.approx(7_881.0),
            "currency": "ILS",
            "fx_to_usd": pytest.approx(0.25),
            "adjusted_close_usd": pytest.approx(19.7025),
            "fx_quote_date": "2026-07-13",
        }
    ]


def test_price_bundle_warns_when_a_corporate_action_successor_is_unavailable(monkeypatch, tmp_path) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "portfolio_corporate_actions.json").write_text(
        """{
          "OLD.TA": {
            "successor_symbol": "NEW.TA",
            "effective_date": "2026-07-13",
            "shares_per_predecessor_share": 0.555,
            "source": "https://example.test/official-filing"
          }
        }""",
        encoding="utf-8",
    )

    def fake_history(symbol: str, start: date, end: date):
        del start, end
        return {
            "OLD.TA": {date(2026, 7, 9): 7_900.0},
            "NEW.TA": {},
            "ILS=X": {date(2026, 7, 9): 4.0},
            "QQQ": {date(2026, 7, 9): 100.0},
        }[symbol]

    monkeypatch.setattr(portfolio_prices, "fetch_adjusted_closes", fake_history)
    result = fetch_price_bundle(
        [{"symbol": "OLD.TA", "currency": "ILS"}],
        start=date(2026, 7, 1),
        end=date(2026, 7, 20),
        repo_root=tmp_path,
        benchmark_symbol="QQQ",
        workers=1,
    )

    assert result["errors"] == [
        {"symbol": "OLD.TA", "error": "corporate_action_successor_no_data"}
    ]
