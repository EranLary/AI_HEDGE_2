from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from ai_hedge.deep_research.deepseek_engine import (
    DEEPSEEK_FLASH_MODEL,
    DEEPSEEK_PRO_MODEL,
    DeepSeekResearchConfig,
    DeepSeekResearchEngine,
    DeepSeekResearchResult,
    SourceRepository,
    UsageLedger,
    select_valuation_sources,
    review_hard_blockers,
)
from ai_hedge.deep_research.snapshot import CompanySnapshot
from ai_hedge.deep_research.filings import fetch_primary_filing_packet
from ai_hedge.deep_research.input_packet import build_research_input_packet
from ai_hedge.deep_research.valuation_policy import (
    build_canonical_valuation_anchors,
    build_valuation_method_policy,
    repair_method_policy_issues,
    valuation_method_policy_issues,
)


def _usage(**values: int) -> SimpleNamespace:
    return SimpleNamespace(usage=SimpleNamespace(**values))


def test_usage_ledger_prices_peak_pro_tokens() -> None:
    ledger = UsageLedger()
    ledger.add(
        stage="test",
        model=DEEPSEEK_PRO_MODEL,
        response=_usage(
            prompt_tokens=1_000_000,
            completion_tokens=100_000,
            prompt_cache_hit_tokens=250_000,
            prompt_cache_miss_tokens=750_000,
        ),
        at=datetime(2026, 10, 6, 7, tzinfo=timezone.utc),
    )

    assert ledger.estimated_cost_usd == pytest.approx(1.397)
    assert ledger.to_dict()["calls"][0]["model"] == DEEPSEEK_PRO_MODEL


def test_usage_ledger_prices_offpeak_flash_tokens() -> None:
    ledger = UsageLedger()
    ledger.add(
        stage="test",
        model=DEEPSEEK_FLASH_MODEL,
        response=_usage(
            prompt_tokens=1_000_000,
            completion_tokens=100_000,
            prompt_cache_hit_tokens=0,
            prompt_cache_miss_tokens=1_000_000,
        ),
        at=datetime(2026, 10, 4, 7, tzinfo=timezone.utc),
    )

    assert ledger.estimated_cost_usd == pytest.approx(0.21)


def test_model_self_review_is_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPSEEK_RESEARCH_ENABLE_MODEL_REVIEW", raising=False)
    assert DeepSeekResearchConfig.from_env().enable_model_review is False

    monkeypatch.setenv("DEEPSEEK_RESEARCH_ENABLE_MODEL_REVIEW", "true")
    assert DeepSeekResearchConfig.from_env().enable_model_review is True


class _FakeSearchClient:
    def news(self, *_args: object, **_kwargs: object) -> list[dict[str, str]]:
        return []

    def text(self, *_args: object, **_kwargs: object) -> list[dict[str, str]]:
        return [
            {
                "title": "Issuer filing",
                "href": "https://example.com/filing?utm_source=test",
                "body": "Filed revenue was 100.",
            }
        ]

    def extract(self, *_args: object, **_kwargs: object) -> dict[str, str]:
        return {"content": "Annual report. Revenue was 100 and cash was 20."}


class _MixedSearchClient(_FakeSearchClient):
    def news(self, *_args: object, **_kwargs: object) -> list[dict[str, str]]:
        return [
            {
                "title": f"News {index}",
                "url": f"https://news.example.com/{index}",
                "body": "Topical story",
            }
            for index in range(5)
        ]

    def text(self, *_args: object, **_kwargs: object) -> list[dict[str, str]]:
        return [
            {
                "title": f"Web {index}",
                "href": f"https://web.example.com/{index}",
                "body": "Durable source",
            }
            for index in range(5)
        ]


def test_source_repository_deduplicates_and_persists_extract(tmp_path: Path) -> None:
    repository = SourceRepository(
        output_dir=tmp_path,
        config=DeepSeekResearchConfig(),
        search_client_factory=_FakeSearchClient,
    )

    first = repository.search(query="issuer annual report", kind="web")
    second = repository.search(query="issuer filing", kind="web")
    opened = repository.open(source_id="S001", focus="revenue")

    assert first["results"][0]["source_id"] == "S001"
    assert second["results"][0]["source_id"] == "S001"
    assert len(repository.sources) == 1
    assert repository.sources["S001"]["queries"] == [
        "issuer annual report",
        "issuer filing",
    ]
    assert "Revenue was 100" in opened["content"]
    assert (tmp_path / "source_documents" / "S001.txt").exists()

    assert repository.redact_for_provider_filter("S001") is True
    packet = repository.evidence_packet()[0]
    assert packet["opened"] is False
    assert packet["provider_blocked"] is True
    assert packet["content_excerpt"] == ""


def test_source_repository_registers_preloaded_primary_filing(tmp_path: Path) -> None:
    repository = SourceRepository(
        output_dir=tmp_path,
        config=DeepSeekResearchConfig(),
        search_client_factory=_FakeSearchClient,
    )

    source_id = repository.register_preloaded(
        {
            "title": "10-Q",
            "url": "https://www.sec.gov/Archives/example.htm",
            "publisher": "SEC EDGAR",
            "published_at": "2026-08-01",
            "text": "Filed revenue was 100.",
        }
    )

    assert source_id == "S001"
    assert repository.open_count == 1
    assert repository.sources[source_id]["opened"] is True
    assert repository.sources[source_id]["extraction_provider"] == "platform SEC/MAYA filing router"


def test_find_searches_complete_preloaded_filing_and_retains_focused_excerpt(
    tmp_path: Path,
) -> None:
    filing_path = tmp_path / "annual-filing.txt"
    filing_path.write_text(
        "opening summary\n"
        + ("ordinary disclosure\n" * 2_000)
        + "Stock-based compensation was 146 million.\n",
        encoding="utf-8",
    )
    repository = SourceRepository(
        output_dir=tmp_path,
        config=DeepSeekResearchConfig(max_source_chars=200),
    )
    source_id = repository.register_preloaded(
        {
            "title": "Annual filing",
            "url": "https://www.sec.gov/Archives/annual.htm",
            "publisher": "SEC EDGAR",
            "published_at": "2026-02-26",
            "kind": "primary_filing",
            "text": filing_path.read_text(encoding="utf-8"),
            "local_path": str(filing_path),
        }
    )

    found = repository.find(source_id=source_id, pattern="stock-based compensation")

    assert found["found"] is True
    assert "146 million" in found["matches"][0]
    packet = repository.evidence_packet()
    assert packet[0]["focused_excerpts"][0]["pattern"] == "stock-based compensation"


def test_combined_search_interleaves_web_and_news_results(tmp_path: Path) -> None:
    repository = SourceRepository(
        output_dir=tmp_path,
        config=DeepSeekResearchConfig(),
        search_client_factory=_MixedSearchClient,
    )

    result = repository.search(query="issuer evidence", kind="both", max_results=4)

    assert [row["kind"] for row in result["results"]] == [
        "web",
        "news",
        "web",
        "news",
    ]


def test_valuation_source_packet_keeps_cited_and_deterministic_sources() -> None:
    evidence = {
        "evidence": [{"source_ids": ["S002"]}],
        "coverage": {"financials": {"supporting_source_ids": ["S003"]}},
        "contradictions": [],
    }
    packet = [
        {"source_id": "S001", "kind": "web"},
        {"source_id": "S002", "kind": "web"},
        {"source_id": "S003", "kind": "news"},
        {"source_id": "S004", "kind": "deterministic_market_input"},
    ]

    selected = select_valuation_sources(evidence, packet)

    assert [row["source_id"] for row in selected] == ["S002", "S003", "S004"]


def test_review_hard_blockers_ignores_prose_gaps_but_blocks_valuation_dates() -> None:
    review = {
        "major_issues": [
            {"category": "Unsupported numerical claims", "description": "Remove detail"},
            {"category": "Valuation dates", "description": "Cash-flow timing mismatch"},
        ]
    }

    blockers = review_hard_blockers(review)

    assert len(blockers) == 1
    assert blockers[0]["category"] == "Valuation dates"


class _FakeTicker:
    def __init__(self, symbol: str) -> None:
        self.symbol = symbol
        self.info = {
            "sector": "Technology",
            "industry": "Software",
            "country": "Israel",
            "longBusinessSummary": "A deterministic company description.",
        }

    def history(self, **_kwargs: object):
        import pandas as pd

        values = {"ILSUSD=X": 0.3, "^TNX": 4.2}
        value = values.get(self.symbol)
        if value is None:
            return pd.DataFrame()
        return pd.DataFrame(
            {"Close": [value]}, index=[pd.Timestamp("2026-10-05", tz="UTC")]
        )


def test_input_packet_adds_fx_and_rate_without_yahoo_financials() -> None:
    snapshot = CompanySnapshot(
        ticker="TEST",
        company_name="Test Inc.",
        exchange="Nasdaq",
        security_type="EQUITY",
        quote_currency="USD",
        reporting_currency="ILS",
        current_price=10.0,
        as_of_utc="2026-10-05T06:03:36Z",
    )

    packet = build_research_input_packet(
        snapshot, ticker_factory=_FakeTicker
    ).to_dict()

    fx = packet["currency_context"]["reporting_to_quote_fx"]
    assert fx["quote_units_per_base_unit"] == pytest.approx(0.3)
    assert packet["risk_free_context"]["annual_rate_decimal"] == pytest.approx(0.042)
    assert "shares outstanding" in packet["policy"]["forbidden_as_final_evidence"]


def test_filing_packet_reuses_platform_router_and_persists_text(tmp_path: Path) -> None:
    snapshot = CompanySnapshot(
        ticker="TEST",
        company_name="Test Inc.",
        exchange="Nasdaq",
        security_type="EQUITY",
        quote_currency="USD",
        reporting_currency="USD",
        current_price=10.0,
        as_of_utc="2026-10-05T06:03:36Z",
    )

    packet = fetch_primary_filing_packet(
        snapshot,
        output_dir=tmp_path,
        fetcher=lambda _ticker, _info: {
            "10-Q": {
                "url": "https://www.sec.gov/Archives/example.htm",
                "text": "Quarterly filing text",
                "date": "2026-08-01",
            }
        },
    )

    assert packet[0]["publisher"] == "SEC EDGAR"
    assert Path(packet[0]["local_path"]).read_text(encoding="utf-8").startswith(
        "Quarterly filing text"
    )


def test_deepseek_result_matches_provider_runner_contract(tmp_path: Path) -> None:
    result = DeepSeekResearchResult(
        run_id="run-1",
        ticker="TEST",
        output_dir=tmp_path,
        report_path=tmp_path / "research_report.md",
        manifest_path=tmp_path / "research_manifest.json",
        quality_path=tmp_path / "research_quality.json",
    )

    assert result.provider == "deepseek"
    assert result.status == "completed"


def test_case_policy_requires_one_year_target_sourced_shares_and_positive_methods() -> None:
    snapshot = CompanySnapshot(
        ticker="TEST",
        company_name="Test Inc.",
        exchange="Nasdaq",
        security_type="EQUITY",
        quote_currency="USD",
        reporting_currency="USD",
        current_price=10.0,
        as_of_utc="2026-10-05T06:03:36Z",
    )
    case = {
        "reference_date": "2026-10-04",
        "target_date": "2026-10-05",
        "reference_price": 11.0,
        "diluted_shares_evidence_id": "shares",
        "evidence": [
            {
                "id": "shares",
                "kind": "analyst_assumption",
                "source_url": None,
            }
        ],
        "methods": [{"weight_pct": 0}],
    }

    issues = DeepSeekResearchEngine._case_policy_issues(snapshot, case)

    assert any("reference_date" in issue for issue in issues)
    assert any("target_date" in issue for issue in issues)
    assert any("reference_price" in issue for issue in issues)
    assert any("diluted shares" in issue for issue in issues)
    assert any("non-positive weight" in issue for issue in issues)


def test_case_policy_rejects_asset_only_going_concern_target() -> None:
    snapshot = CompanySnapshot(
        ticker="TEST",
        company_name="Test Inc.",
        exchange="Nasdaq",
        security_type="EQUITY",
        quote_currency="USD",
        reporting_currency="USD",
        current_price=10.0,
        as_of_utc="2026-10-05T06:03:36Z",
    )
    case = {
        "reference_date": "2026-10-05",
        "target_date": "2027-10-05",
        "reference_price": 10.0,
        "diluted_shares_evidence_id": "shares",
        "evidence": [
            {"id": "shares", "kind": "reported_fact", "source_url": "https://example.com"}
        ],
        "methods": [{"type": "asset", "weight_pct": 100.0}],
    }

    issues = DeepSeekResearchEngine._case_policy_issues(snapshot, case)

    assert any("income or cash-flow" in issue for issue in issues)


def test_case_policy_rejects_unscaled_million_share_unit() -> None:
    snapshot = CompanySnapshot(
        ticker="TEST",
        company_name="Test Inc.",
        exchange="Nasdaq",
        security_type="EQUITY",
        quote_currency="USD",
        reporting_currency="USD",
        current_price=10.0,
        as_of_utc="2026-10-05T06:03:36Z",
    )
    case = {
        "reference_date": "2026-10-05",
        "target_date": "2027-10-05",
        "reference_price": 10.0,
        "diluted_shares": 19.78,
        "diluted_shares_evidence_id": "shares",
        "evidence": [
            {
                "id": "shares",
                "kind": "reported_fact",
                "value": 19.78,
                "unit": "millions shares",
                "source_url": "https://example.com",
            }
        ],
        "methods": [{"type": "fcfe", "weight_pct": 100.0}],
    }

    issues = DeepSeekResearchEngine._case_policy_issues(snapshot, case)

    assert any("absolute shares" in issue for issue in issues)

    normalized = DeepSeekResearchEngine._normalize_case_units(case)
    assert normalized["diluted_shares"] == pytest.approx(19_780_000)
    assert normalized["evidence"][0]["value"] == pytest.approx(19_780_000)
    assert normalized["evidence"][0]["unit"] == "shares"


def test_case_policy_rejects_per_share_residual_income_inputs() -> None:
    snapshot = CompanySnapshot(
        ticker="TEST",
        company_name="Test Inc.",
        exchange="Nasdaq",
        security_type="EQUITY",
        quote_currency="USD",
        reporting_currency="USD",
        current_price=10.0,
        as_of_utc="2026-10-05T06:03:36Z",
    )
    case = {
        "reference_date": "2026-10-05",
        "target_date": "2027-10-05",
        "reference_price": 10.0,
        "diluted_shares": 20_000_000,
        "diluted_shares_evidence_id": "shares",
        "evidence": [
            {
                "id": "shares",
                "kind": "reported_fact",
                "value": 20_000_000,
                "unit": "shares",
                "source_url": "https://example.com/shares",
            },
            {
                "id": "book",
                "kind": "reported_fact",
                "value": 10.0,
                "unit": "USD per share",
                "source_url": "https://example.com/book",
            },
        ],
        "methods": [
            {
                "type": "residual_income",
                "weight_pct": 100.0,
                "beginning_book_equity_evidence_id": "book",
                "periods": [
                    {
                        "net_income": 3.0,
                        "dividends": 1.0,
                        "rationale": "EPS and DPS forecast per share",
                    }
                ],
            }
        ],
    }

    issues = DeepSeekResearchEngine._case_policy_issues(snapshot, case)

    assert any("absolute company total" in issue for issue in issues)
    assert any("per-share inputs" in issue for issue in issues)


def _profitable_software_policy() -> dict[str, object]:
    return build_valuation_method_policy(
        input_packet={
            "company_profile": {
                "sector": "Technology",
                "industry": "Software - Application",
            }
        },
        evidence={
            "evidence": [
                {
                    "claim_id": "profit",
                    "claim": "FY2025 GAAP net income",
                    "value": 100.0,
                    "unit": "USD millions",
                    "scope": "Consolidated GAAP",
                    "fact_type": "reported_fact",
                }
            ]
        },
    )


def test_profitable_non_financial_policy_locks_two_methods_at_50_50() -> None:
    policy = _profitable_software_policy()

    assert policy["locked"] is True
    assert policy["classification"] == "profitable_non_financial"
    assert [row["weight_pct"] for row in policy["central_methods"]] == [50.0, 50.0]


def test_financial_company_does_not_receive_generic_two_method_lock() -> None:
    policy = build_valuation_method_policy(
        input_packet={
            "company_profile": {
                "sector": "Financial Services",
                "industry": "Capital Markets",
            }
        },
        evidence={
            "evidence": [
                {
                    "claim_id": "profit",
                    "claim": "GAAP net income",
                    "value": 100.0,
                    "unit": "USD millions",
                    "scope": "Consolidated",
                    "fact_type": "reported_fact",
                }
            ]
        },
    )

    assert policy["locked"] is False
    assert policy["classification"] == "flexible_special_case"


def test_locked_policy_rejects_residual_income_substitution_and_wrong_weights() -> None:
    policy = _profitable_software_policy()
    case = {
        "evidence": [
            {
                "id": "eps",
                "unit": "USD per share",
                "rationale": "Forward normalized GAAP earnings",
            }
        ],
        "methods": [
            {"type": "residual_income", "weight_pct": 40.0},
            {
                "type": "multiple",
                "weight_pct": 60.0,
                "subject_metric_basis": "trailing",
                "peer_metric_basis": "trailing",
                "subject_metric_evidence_id": "eps",
            },
        ],
    }

    issues = valuation_method_policy_issues(policy, case)

    assert any("exactly one DCF/FCFE" in issue for issue in issues)
    assert any("exactly 50%" in issue for issue in issues)
    assert any("forward basis" in issue for issue in issues)


def test_locked_policy_rejects_management_non_gaap_central_earnings() -> None:
    policy = _profitable_software_policy()
    case = {
        "evidence": [
            {
                "id": "eps",
                "unit": "USD non-GAAP EPS",
                "rationale": "Management FY2027 non-GAAP EPS guidance",
            }
        ],
        "methods": [
            {"type": "fcfe", "weight_pct": 50.0, "cash_flows_per_share": []},
            {
                "type": "multiple",
                "weight_pct": 50.0,
                "subject_metric_basis": "forward",
                "peer_metric_basis": "forward",
                "subject_metric_evidence_id": "eps",
            },
        ],
    }

    issues = valuation_method_policy_issues(policy, case)

    assert any("independently reconciled from GAAP" in issue for issue in issues)


def test_repair_cannot_switch_a_valid_fcfe_blueprint_to_dcf() -> None:
    policy = _profitable_software_policy()
    evidence = [
        {
            "id": "eps",
            "unit": "USD per share",
            "rationale": "Forward normalized earnings reconciled from GAAP",
        }
    ]
    prior = {
        "evidence": evidence,
        "methods": [
            {"type": "fcfe", "weight_pct": 50.0, "cash_flows_per_share": []},
            {
                "type": "multiple",
                "weight_pct": 50.0,
                "subject_metric_basis": "forward",
                "peer_metric_basis": "forward",
                "subject_metric_evidence_id": "eps",
            },
        ],
    }
    candidate = {
        "evidence": evidence,
        "methods": [
            {"type": "dcf", "weight_pct": 50.0, "cash_flows_per_share": []},
            {
                "type": "multiple",
                "weight_pct": 50.0,
                "subject_metric_basis": "forward",
                "peer_metric_basis": "forward",
                "subject_metric_evidence_id": "eps",
            },
        ],
    }

    issues = repair_method_policy_issues(policy, prior, candidate)

    assert any("cannot switch" in issue for issue in issues)


def test_anchor_packet_normalizes_explicit_thousand_share_units() -> None:
    anchors = build_canonical_valuation_anchors(
        {
            "evidence": [
                {
                    "claim_id": "shares",
                    "claim": "Weighted average diluted shares",
                    "value": 59_394,
                    "unit": "thousands diluted shares",
                    "period_or_date": "Q2 2026",
                    "fact_type": "reported_fact",
                },
                {
                    "claim_id": "sbc",
                    "claim": "Share-based compensation expense",
                    "value": 88.1,
                    "unit": "USD millions",
                    "period_or_date": "H1 2026",
                    "fact_type": "reported_fact",
                },
            ]
        }
    )

    share = anchors["anchors"]["diluted_shares"]["candidates"][0]
    assert share["canonical_absolute_shares"] == pytest.approx(59_394_000)
    assert anchors["anchors"]["stock_compensation"]["status"] == "available"


def test_case_unit_normalization_uses_explicit_million_scale_in_rationale() -> None:
    case = {
        "diluted_shares": 59.43,
        "diluted_shares_evidence_id": "shares",
        "evidence": [
            {
                "id": "shares",
                "value": 59.43,
                "unit": "shares",
                "rationale": "Derived weighted-average diluted shares of 59.43M",
            }
        ],
    }

    normalized = DeepSeekResearchEngine._normalize_case_units(case)

    assert normalized["diluted_shares"] == pytest.approx(59_430_000)
    assert normalized["evidence"][0]["value"] == pytest.approx(59_430_000)
