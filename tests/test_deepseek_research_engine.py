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
)
from ai_hedge.deep_research.snapshot import CompanySnapshot


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
