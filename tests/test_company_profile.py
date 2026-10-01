import json

from ai_hedge.company_profile import resolve_company_profile
from ai_hedge.db.transform import ticker_dir_to_row


def test_company_profile_prefers_analysis_info_used_by_valuation():
    profile = resolve_company_profile(
        {
            "info": {"sector": " Financial Services ", "industry": " Banks - Regional "},
            "yahooquery": {
                "company_profile": {
                    "sector": "Other sector",
                    "industry": "Other industry",
                }
            },
        }
    )

    assert profile == {
        "sector": "Financial Services",
        "industry": "Banks - Regional",
        "source": "yfinance.info",
    }


def test_company_profile_uses_field_level_yahooquery_fallback_without_overwriting_sector():
    profile = resolve_company_profile(
        {
            "info": {"sector": "Technology", "industry": ""},
            "yahooquery": {
                "company_profile": {
                    "sector": "Different sector",
                    "industry": "Software - Infrastructure",
                }
            },
        }
    )

    assert profile == {
        "sector": "Technology",
        "industry": "Software - Infrastructure",
        "source": "yfinance.info+yahooquery.asset_profile",
    }


def test_company_profile_reports_explicit_llm_override_provenance():
    profile = resolve_company_profile(
        {
            "company_profile_override": {
                "sector": "Technology",
                "source": "llm.deepseek-v4-flash",
            },
            "info": {"sector": "Technology", "industry": "Software"},
        }
    )

    assert profile == {
        "sector": "Technology",
        "industry": "Software",
        "source": "llm.deepseek-v4-flash+yfinance.info",
    }


def test_report_only_llm_sector_is_not_promoted_to_ticker_profile(tmp_path):
    ticker_dir = tmp_path / "TEST"
    ticker_dir.mkdir()
    (ticker_dir / "TEST_dashboard.json").write_text(
        json.dumps(
            {
                "ticker": "TEST",
                "generated_at": "2026-10-01T00:00:00+00:00",
                "company_profile": {
                    "sector": "Technology",
                    "industry": "Software",
                    "source": "llm.deepseek-v4-flash+yfinance.info",
                },
                "header": {"company_name": "Test", "current_price": 100, "currency": "USD"},
                "valuation_hub": {"consensus": {"mean_target_price": 120}},
                "score_card": {"position_size_pct_of_notional": 5},
            }
        ),
        encoding="utf-8",
    )
    (ticker_dir / "TEST_analysis.md").write_text("# Test", encoding="utf-8")

    bundle = ticker_dir_to_row(ticker_dir, source="test")
    assert bundle is not None
    assert bundle["ticker_row"]["sector"] is None
    assert bundle["ticker_row"]["industry"] == "Software"
    assert bundle["ticker_row"]["profile_source"] == "yfinance.info"
