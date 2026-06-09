from __future__ import annotations

from ai_hedge.dashboard import build_wall_st_payload


def _table(columns, values, index=None):
    return {
        "index": index or [str(i) for i in range(len(values))],
        "columns": columns,
        "values": values,
    }


def test_build_wall_st_payload_preserves_original_targets_and_metrics():
    info_dict = {
        "wall_st_raw": {
            "targets": {"current": 62.8, "high": 100.0, "low": 44.78, "mean": 67.63692, "median": 65.0},
            "recommendations": _table(
                ["period", "strongBuy", "buy", "hold", "sell", "strongSell"],
                [["0m", 1, 10, 2, 0, 0], ["-1m", 1, 9, 3, 0, 0]],
            ),
            "down_upgrades": _table(
                ["Firm", "ToGrade", "FromGrade", "Action", "priceTargetAction", "currentPriceTarget", "priorPriceTarget"],
                [["Firm A", "Buy", "Hold", "up", "Raises", 100.0, 70.0]],
                ["2026-01-01 12:00:00"],
            ),
            "earnings_estimate": _table(
                ["avg", "low", "high", "yearAgoEps", "numberOfAnalysts", "growth"],
                [[0.33, 0.12, 0.44, -1.82, 4.0, 1.18]],
                ["0y"],
            ),
            "revenue_estimate": _table(
                ["avg", "low", "high", "numberOfAnalysts", "yearAgoRevenue", "growth"],
                [[268_680_180.0, 264_600_000.0, 283_668_000.0, 10.0, 130_016_000.0, 1.0665]],
                ["0y"],
            ),
            "num_of_analysts": 9,
            "currency": {
                "original_price_currency": "USD",
                "original_financial_currency": "USD",
                "price_currency_to_USD": 1,
                "financial_currency_to_USD": 1,
            },
        }
    }

    payload = build_wall_st_payload(ticker="IONQ", info_dict=info_dict)

    assert payload["status"] == "success"
    assert payload["raw"]["targets"]["mean"] == 67.63692
    assert round(payload["metrics"]["targets"]["upside_pct"], 2) == 7.70
    assert payload["metrics"]["recommendations"]["posture"] == "buy-skewed"
    assert payload["metrics"]["recommendations"]["trend"] == "improving"
    assert payload["metrics"]["recent_actions"][0]["Firm"] == "Firm A"
    assert payload["metrics"]["earnings_rows"][0]["_index"] == "0y"
    assert payload["metrics"]["revenue_rows"][0]["growth"] == 1.0665


def test_build_wall_st_payload_handles_partial_hold_heavy_tables():
    info_dict = {
        "wall_st_raw": {
            "targets": {"current": 39.832641676304505, "high": 46.66984148581536, "low": 46.66984148581536, "mean": 46.66984148581536},
            "recommendations": _table(
                ["period", "strongBuy", "buy", "hold", "sell", "strongSell"],
                [["0m", 0, 0, 1, 0, 0], ["-1m", 0, 0, 2, 0, 0]],
            ),
            "down_upgrades": _table([], []),
            "earnings_estimate": _table([], []),
            "revenue_estimate": _table(
                ["avg", "low", "high", "numberOfAnalysts", "yearAgoRevenue", "growth"],
                [[12_806_000_000.0, 12_806_000_000.0, 12_806_000_000.0, 1.0, 12_507_000_000.0, 0.0239]],
                ["0y"],
            ),
            "num_of_analysts": 0,
            "currency": {"original_price_currency": "ILA", "original_financial_currency": "ILS"},
        }
    }

    payload = build_wall_st_payload(ticker="STRS.TA", info_dict=info_dict)

    assert payload["status"] == "success"
    assert payload["raw"]["currency"]["original_price_currency"] == "ILA"
    assert payload["metrics"]["recommendations"]["posture"] == "hold-heavy"
    assert payload["metrics"]["recent_actions"] == []
    assert payload["metrics"]["earnings_rows"] == []
    assert payload["metrics"]["revenue_rows"][0]["numberOfAnalysts"] == 1.0
