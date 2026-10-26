from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_hedge.harness import HarnessSession, engine_descriptor, normalize_engine_id
from ai_hedge.harness.extraction import extract_web_claims
from ai_hedge.harness.models import ClaimKind


def _session(tmp_path: Path, engine: str = "hybrid_v1") -> HarnessSession:
    return HarnessSession(
        descriptor=engine_descriptor(engine),
        ticker="TEST",
        workspace="analysis",
        output_dir=tmp_path,
        job_id="TEST_job",
        code_version="test-sha",
    )


def test_engine_contract_defaults_and_rejects_hybrid_nasdaq() -> None:
    assert normalize_engine_id(None) == "deterministic_v1"
    assert normalize_engine_id("hybrid_v1") == "hybrid_v1"
    with pytest.raises(ValueError, match="analysis workspace"):
        normalize_engine_id("hybrid_v1", workspace="nasdaq100")
    with pytest.raises(ValueError, match="Unknown analysis engine"):
        normalize_engine_id("magic")


def test_critical_conflict_is_preserved_and_disables_automation(tmp_path: Path) -> None:
    session = _session(tmp_path)
    source_a = session.add_source(
        canonical_uri="filing://a",
        source_type="official_filing",
        content="100 shares",
        authority_score=0.88,
    )
    evidence_a = session.add_evidence(
        source_id=source_a.id,
        excerpt="100 shares",
        locator="page:1",
        extraction_method="test",
        quality=0.88,
    )
    source_b = session.add_source(
        canonical_uri="provider://b",
        source_type="provider",
        content="120 shares",
        authority_score=0.60,
    )
    evidence_b = session.add_evidence(
        source_id=source_b.id,
        excerpt="120 shares",
        locator="$.shares",
        extraction_method="test",
        quality=0.60,
    )
    first = session.add_claim(
        kind=ClaimKind.FACT,
        statement="Shares are 100",
        subject="TEST",
        predicate="shares_outstanding",
        canonical_key="valuation.shares_outstanding",
        value=100,
        unit="shares",
        origin_stage="test",
        origin_type="external",
        evidence_ids=[evidence_a.id],
        source_score=0.88,
        confidence=0.88,
    )
    second = session.add_claim(
        kind=ClaimKind.FACT,
        statement="Shares are 120",
        subject="TEST",
        predicate="shares_outstanding",
        canonical_key="valuation.shares_outstanding",
        value=120,
        unit="shares",
        origin_stage="test",
        origin_type="external",
        evidence_ids=[evidence_b.id],
        source_score=0.60,
        confidence=0.60,
    )

    session.reconcile()

    assert session.state.quality_status == "amber_conflict"
    assert session.state.automation_eligible is False
    assert session.state.contradictions[0].claim_ids == [first.id, second.id]
    assert session.state.contradictions[0].selected_claim_id == first.id
    assert len(session.state.sensitivity_scenarios) == 2
    assert {row.candidate_value for row in session.state.sensitivity_scenarios} == {100, 120}
    session.capture_valuation_outputs({"Prices": {"Mean": [120.0]}})
    session.apply_valuation_sensitivity({"Prices": {"Mean": [120.0]}})
    alternative = next(row for row in session.state.sensitivity_scenarios if not row.selected)
    assert alternative.calculation_status == "calculated"
    assert alternative.scenario_target_price == pytest.approx(100.0)
    assert alternative.target_impact_pct == pytest.approx(-16.6666667)
    paths = session.finalize()
    persisted = json.loads(Path(paths["valuation_sensitivity_json"]).read_text(encoding="utf-8"))
    persisted_alternative = next(row for row in persisted if not row["selected"])
    assert persisted_alternative["scenario_target_price"] == pytest.approx(100.0)


def test_matching_claims_support_each_other_without_conflict(tmp_path: Path) -> None:
    session = _session(tmp_path)
    session.capture_provider_snapshot(
        info_dict={"currency": "USD"},
        financial_dict={},
        variables_dict={"shares_outstanding": 100.0},
    )
    session.capture_share_count(
        {
            "source_type": "official_filing",
            "selected_shares_outstanding": 100.2,
            "evidence_excerpt": "100.2 shares outstanding",
            "provider_candidates": {},
        }
    )
    session.reconcile()
    assert session.state.quality_status == "green"
    assert not session.state.contradictions
    assert any(row.relation.value == "supports" for row in session.state.relations)


def test_provider_snapshot_excludes_fx_rates_and_historical_market_caps(tmp_path: Path) -> None:
    session = _session(tmp_path)
    session.capture_provider_snapshot(
        info_dict={
            "info": {"currency": "USD", "marketCap": 700},
            "yahooquery": {
                "valuation_measures": {
                    "latest": {"MarketCap": 600},
                    "recent_average": {"MarketCap": 550},
                }
            },
        },
        financial_dict={"info": {"currency": "USD"}},
        variables_dict={
            "market_cap": 720,
            "price_currency": 1.0,
            "financial_currency": 1.0,
            "shares_outstanding": 100,
        },
    )
    session.reconcile()

    market_caps = [
        claim for claim in session.state.claims if claim.canonical_key == "valuation.market_cap"
    ]
    currency_claims = [
        claim
        for claim in session.state.claims
        if claim.canonical_key in {"company.currency", "company.financial_currency", "company.price_currency"}
    ]
    assert [claim.value for claim in market_caps] == [720]
    assert {claim.value for claim in currency_claims} == {"USD"}
    assert not session.state.contradictions


def test_stage_can_be_explicitly_marked_failed_without_raising(tmp_path: Path) -> None:
    session = _session(tmp_path)
    with session.stage("optional", {"input": 1}) as stage:
        stage.status = "failed"
        stage.error = "provider unavailable"
        session.complete_stage(stage, {"status": "error"})

    assert stage.status == "failed"
    assert stage.error == "provider unavailable"


def test_valuation_outputs_preserve_assumptions_inferences_and_conclusions(tmp_path: Path) -> None:
    session = _session(tmp_path)
    session.capture_valuation_outputs(
        {
            "Prices": {"Mean": [125.0]},
            "Revenue": {"Mean": [2_000_000.0]},
            "Method": {"raw_json": {"growth_assumption": "8% for three years"}},
        },
        valuation_details={
            "methods": {
                "Scenario DCF": [
                    {
                        "raw_json": {
                            "bull": [0.25, 600_000_000, 0.08, 0.095, 0.025],
                            "base": [0.50, 520_000_000, 0.05, 0.10, 0.025],
                            "bear": [0.25, 400_000_000, -0.02, 0.11, 0.02],
                            "target_market_cap": 7_000_000_000,
                        }
                    }
                ]
            }
        },
    )

    by_kind = {claim.kind for claim in session.state.claims}
    assert ClaimKind.ASSUMPTION in by_kind
    assert ClaimKind.INFERENCE in by_kind
    assert ClaimKind.CONCLUSION in by_kind
    assert all(claim.evidence_ids for claim in session.state.claims)
    assumption_claims = [claim for claim in session.state.claims if claim.kind == ClaimKind.ASSUMPTION]
    assert len(assumption_claims) >= 15
    assert not any("target_market_cap" in claim.canonical_key for claim in assumption_claims)


def test_reconciliation_records_have_stable_ids(tmp_path: Path) -> None:
    session = _session(tmp_path)
    session.capture_provider_snapshot(
        info_dict={"currency": "USD"},
        financial_dict={"currency": "EUR"},
        variables_dict={},
    )
    session.reconcile()
    first_ids = (
        [row.id for row in session.state.relations],
        [row.id for row in session.state.contradictions],
        [row.id for row in session.state.sensitivity_scenarios],
    )
    session.reconcile()
    assert first_ids == (
        [row.id for row in session.state.relations],
        [row.id for row in session.state.contradictions],
        [row.id for row in session.state.sensitivity_scenarios],
    )


def test_hybrid_readiness_requires_shares_and_currency(tmp_path: Path) -> None:
    session = _session(tmp_path)
    session.reconcile()
    assert session.valuation_readiness_issues() == [
        "missing defensible total-company shares outstanding",
        "missing defensible currency",
    ]

    session.capture_provider_snapshot(
        info_dict={"currency": "USD"},
        financial_dict={},
        variables_dict={"sharesOutstanding": 100},
    )
    session.reconcile()
    assert session.valuation_readiness_issues() == []


def test_finalize_writes_replayable_artifacts(tmp_path: Path) -> None:
    session = _session(tmp_path, "deterministic_v1")
    with session.stage("example", {"input": 1}) as stage:
        session.complete_stage(stage, {"output": 2})

    paths = session.finalize()

    assert set(paths) == {
        "research_state_json",
        "execution_manifest_json",
        "evidence_ledger_jsonl",
        "contradictions_json",
        "valuation_sensitivity_json",
        "research_source_bodies_jsonl",
        "checkpoint_latest_json",
    }
    state = json.loads(Path(paths["research_state_json"]).read_text(encoding="utf-8"))
    manifest = json.loads(Path(paths["execution_manifest_json"]).read_text(encoding="utf-8"))
    assert state["engine_id"] == "deterministic_v1"
    assert state["status"] == "completed"
    assert manifest["stages"][0]["input_sha256"]
    assert manifest["stages"][0]["output_sha256"]
    assert Path(paths["checkpoint_latest_json"]).exists()


def test_web_claim_extractor_rejects_non_verbatim_and_incomplete_candidates() -> None:
    payload = {
        "sources": [
            {
                "url": "https://example.com/filing",
                "title": "Filing",
                "content_excerpt": "As of 2026-09-30, total shares outstanding were 1000000 shares.",
            }
        ]
    }
    raw = json.dumps(
        [
            {
                "source_index": 0,
                "canonical_key": "valuation.shares_outstanding",
                "statement": "One million shares were outstanding.",
                "value": 1_000_000,
                "quote": "total shares outstanding were 1000000 shares",
                "unit": "shares",
                "currency": None,
                "period": None,
                "as_of": "2026-09-30",
                "confidence": 0.9,
            },
            {
                "source_index": 0,
                "canonical_key": "valuation.market_cap",
                "statement": "Market cap is 5 billion.",
                "value": 5_000_000_000,
                "quote": "not present in the source",
                "unit": "USD",
                "currency": "USD",
                "period": None,
                "as_of": "2026-09-30",
                "confidence": 0.9,
            },
        ]
    )
    accepted = extract_web_claims(
        payload,
        ticker="TEST",
        gap_context="shares",
        call_llm=lambda _prompt: raw,
    )
    assert len(accepted) == 1
    assert accepted[0].canonical_key == "valuation.shares_outstanding"


def test_web_claim_extractor_normalizes_bounded_confidence_labels() -> None:
    payload = {
        "sources": [
            {
                "url": "https://example.com/filing",
                "title": "Filing",
                "content_excerpt": "As of 2026-09-30, total shares outstanding were 1000000 shares.",
            }
        ]
    }
    raw = json.dumps(
        [
            {
                "source_index": 0,
                "canonical_key": "valuation.shares_outstanding",
                "statement": "One million shares were outstanding.",
                "value": 1_000_000,
                "quote": "total shares outstanding were 1000000 shares",
                "unit": "shares",
                "currency": None,
                "period": None,
                "as_of": "2026-09-30",
                "confidence": "high",
            }
        ]
    )

    accepted = extract_web_claims(
        payload,
        ticker="TEST",
        gap_context="shares",
        call_llm=lambda _prompt: raw,
    )

    assert accepted[0].confidence == pytest.approx(0.9)


def test_budget_exhaustion_survives_failure_finalization(tmp_path: Path) -> None:
    session = _session(tmp_path)
    session.mark_budget_exhausted("query budget")
    session.finalize(success=False)
    assert session.state.status == "budget_exhausted"
    assert session.state.quality_status == "budget_exhausted"
    assert session.state.automation_eligible is False


def test_hybrid_finalize_never_leaves_recorded_errors_green(tmp_path: Path) -> None:
    session = _session(tmp_path)
    session.state.errors.append("typed extraction failed")

    session.finalize(success=True)

    assert session.state.status == "completed"
    assert session.state.quality_status == "red"
    assert session.state.automation_eligible is False


def test_shadow_corpus_has_twenty_companies_and_eight_hard_cases() -> None:
    corpus_path = Path(__file__).parent / "fixtures" / "hybrid_research_corpus_v1.json"
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    companies = corpus["companies"]
    assert len(companies) == 20
    assert len({row["ticker"] for row in companies}) == 20
    assert sum(bool(row.get("hard_case")) for row in companies) == 8
    assert corpus["gates"]["critical_input_evidence_coverage"] == 1.0
