from datetime import date

from scripts.historical_prices_batch import _split_adjust_rows


def test_split_adjust_rows_normalizes_only_sessions_before_the_split() -> None:
    rows = _split_adjust_rows(
        [
            (date(2025, 1, 1), 50.0, None),
            (date(2025, 1, 2), 55.0, 2.0),
            (date(2025, 1, 3), 54.0, None),
        ]
    )

    assert rows == [
        {"date": "2025-01-01", "close": 50.0, "split_factor": 0.5},
        {"date": "2025-01-02", "close": 55.0, "split_factor": 1.0},
        {"date": "2025-01-03", "close": 54.0, "split_factor": 1.0},
    ]


def test_split_adjust_rows_handles_reverse_splits() -> None:
    rows = _split_adjust_rows(
        [
            (date(2025, 1, 1), 50.0, None),
            (date(2025, 1, 2), 48.0, 0.1),
        ]
    )

    assert rows[0]["split_factor"] == 10.0
    assert rows[1]["split_factor"] == 1.0
