from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from ai_hedge.deep_research.provider_benchmark import (
    ProviderBenchmarkEngine,
    _gemini_cost,
    _gemini_report_text,
    _gemini_sources,
    _xai_cost,
)
from ai_hedge.deep_research.snapshot import CompanySnapshot


def _snapshot() -> CompanySnapshot:
    return CompanySnapshot(
        ticker="ITRN",
        company_name="Ituran Location and Control Ltd.",
        exchange="NasdaqGS",
        security_type="EQUITY",
        quote_currency="USD",
        reporting_currency="USD",
        current_price=34.0,
        as_of_utc="2026-10-04T10:00:00Z",
    )


def test_gemini_extracts_report_sources_and_usage_cost() -> None:
    response = SimpleNamespace(
        outputs=[
            SimpleNamespace(
                type="text",
                text="# Research\nDetailed report",
                annotations=[
                    SimpleNamespace(
                        type="url_citation",
                        url="https://example.com/filing",
                        title="Filing",
                        start_index=0,
                        end_index=8,
                    )
                ],
            )
        ]
    )
    usage = SimpleNamespace(
        total_input_tokens=100_000,
        total_cached_tokens=50_000,
        total_output_tokens=20_000,
        total_thought_tokens=10_000,
        grounding_tool_count=[SimpleNamespace(type="google_search", count=80)],
    )

    assert _gemini_report_text(response) == "# Research\nDetailed report"
    assert _gemini_sources(response)[0]["url"] == "https://example.com/filing"
    cost = _gemini_cost(usage)
    assert cost["token_cost_estimate_usd"] == pytest.approx(0.47)
    assert cost["token_cost_estimate_range_usd"] == pytest.approx(
        {"minimum": 0.47, "maximum": 0.76}
    )
    assert cost["google_search_queries"] == 80
    assert cost["total_estimate_range_if_all_searches_billable_usd"] == pytest.approx(
        {"minimum": 1.59, "maximum": 1.88}
    )


def test_xai_converts_provider_reported_cost_ticks() -> None:
    cost = _xai_cost(SimpleNamespace(cost_in_usd_ticks=12_500_000_000))

    assert cost["kind"] == "provider_reported_exact"
    assert cost["cost_usd"] == pytest.approx(1.25)


def test_gemini_run_polls_and_writes_comparable_artifacts(tmp_path: Path) -> None:
    queued = SimpleNamespace(id="interaction-1", status="in_progress")
    completed = SimpleNamespace(
        id="interaction-1",
        status="completed",
        model="gemini-3.1-pro-preview",
        outputs=[SimpleNamespace(type="text", text="# Final report", annotations=[])],
        usage=SimpleNamespace(
            total_input_tokens=10,
            total_cached_tokens=0,
            total_output_tokens=20,
            total_thought_tokens=5,
            grounding_tool_count=[],
        ),
    )
    calls: list[dict[str, object]] = []
    interactions = SimpleNamespace(
        create=lambda **kwargs: calls.append(kwargs) or queued,
        get=lambda _interaction_id: completed,
    )
    engine = ProviderBenchmarkEngine(
        provider="gemini",
        client=SimpleNamespace(interactions=interactions),
        sleep=lambda _seconds: None,
        now=lambda: datetime(2026, 10, 4, 10, 0, tzinfo=timezone.utc),
    )

    result = engine.run(_snapshot(), output_root=tmp_path)

    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert result.status == "completed"
    assert result.report_path.read_text(encoding="utf-8").startswith("# Final report")
    assert manifest["provider"] == "gemini"
    assert manifest["model_actual"] == "gemini-3.1-pro-preview"
    assert "system_instruction" not in calls[0]
    assert calls[0]["input"].startswith(
        "You are an independent senior buy-side equity analyst"
    )
    assert result.quality_path.exists()


def test_xai_run_uses_hosted_search_and_code_and_persists_exact_cost(
    tmp_path: Path,
) -> None:
    response = SimpleNamespace(
        id="resp-1",
        status="completed",
        model="grok-4.7",
        output_text="# Final report",
        output=[],
        usage=SimpleNamespace(
            input_tokens=100,
            output_tokens=50,
            cost_in_usd_ticks=25_000_000,
        ),
    )
    calls: list[dict[str, object]] = []
    responses = SimpleNamespace(
        create=lambda **kwargs: calls.append(kwargs) or response,
    )
    engine = ProviderBenchmarkEngine(
        provider="xai",
        client=SimpleNamespace(responses=responses),
        now=lambda: datetime(2026, 10, 4, 10, 0, tzinfo=timezone.utc),
    )

    result = engine.run(_snapshot(), output_root=tmp_path)

    manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
    assert calls[0]["reasoning"] == {"effort": "xhigh"}
    assert calls[0]["tools"] == [
        {"type": "web_search"},
        {"type": "code_interpreter"},
    ]
    assert manifest["cost"]["cost_usd"] == pytest.approx(0.0025)
