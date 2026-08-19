from datetime import date

import pytest

from ai_hedge.portfolio_prices import build_usd_rows, fx_rate_to_usd


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
