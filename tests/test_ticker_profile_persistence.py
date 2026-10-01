import json
from datetime import datetime, timezone

from ai_hedge.db.transform import ticker_dir_to_row


def test_ticker_row_carries_saved_company_profile(tmp_path):
    ticker_dir = tmp_path / "AAPL"
    ticker_dir.mkdir()
    generated_at = "2026-10-01T12:30:00+00:00"
    dashboard = {
        "ticker": "AAPL",
        "generated_at": generated_at,
        "dashboard_version": "v2",
        "header": {"company_name": "Apple Inc.", "currency": "USD"},
        "company_profile": {
            "sector": "Technology",
            "industry": "Consumer Electronics",
            "source": "yfinance.info",
        },
        "valuation_hub": {"consensus": {}},
    }
    (ticker_dir / "AAPL_dashboard.json").write_text(json.dumps(dashboard), encoding="utf-8")
    (ticker_dir / "AAPL_analysis.md").write_text("# Analysis", encoding="utf-8")

    bundle = ticker_dir_to_row(ticker_dir, source="test")

    assert bundle is not None
    assert bundle["ticker_row"] == {
        "symbol": "AAPL",
        "company_name": "Apple Inc.",
        "exchange": None,
        "currency": "USD",
        "sector": "Technology",
        "industry": "Consumer Electronics",
        "profile_source": "yfinance.info",
        "profile_updated_at": datetime(2026, 10, 1, 12, 30, tzinfo=timezone.utc),
    }
