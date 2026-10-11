from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Mapping

from .deepseek_engine import (
    ENGINE_VERSION,
    DeepSeekResearchEngine,
    DeepSeekResearchResult,
    _iso,
    review_hard_blockers,
    select_valuation_sources,
)
from .engine import _write_json
from .quality import evaluate_run_artifacts, write_quality_report
from .snapshot import CompanySnapshot


def _load_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return payload


def refine_existing_deepseek_run(
    *,
    engine: DeepSeekResearchEngine,
    run_dir: Path,
) -> DeepSeekResearchResult:
    """Reuse a completed run's research and rerun only valuation/publication.

    The original run is immutable. Every refinement gets its own directory and
    usage ledger so its marginal cost is measurable.
    """

    source_dir = Path(run_dir).resolve()
    snapshot = CompanySnapshot(**_load_object(source_dir / "snapshot.json"))
    input_packet = _load_object(source_dir / "research_input_packet.json")
    source_payload = _load_object(source_dir / "research_sources.json")
    sources = [row for row in source_payload.get("sources") or [] if isinstance(row, Mapping)]
    evidence_ledger = _load_object(source_dir / "evidence_ledger.json")
    evidence = {
        "evidence": evidence_ledger.get("evidence") or [],
        "coverage": _load_object(source_dir / "coverage_matrix.json"),
        "contradictions": json.loads(
            (source_dir / "contradictions.json").read_text(encoding="utf-8")
        ),
        "unresolved_red_flags": [],
    }
    plan = _load_object(source_dir / "research_plan.json")
    mandate = (source_dir / "research_prompt.md").read_text(encoding="utf-8")
    prior_report = (source_dir / "research_report.md").read_text(encoding="utf-8")

    started_at = engine.now()
    refinement_id = (
        f"refine-{started_at.strftime('%Y%m%dT%H%M%SZ')}-{snapshot.ticker}-"
        f"{uuid.uuid4().hex[:8]}"
    )
    output_dir = source_dir / "refinements" / refinement_id
    output_dir.mkdir(parents=True, exist_ok=False)
    _write_json(output_dir / "snapshot.json", snapshot.to_dict())
    _write_json(output_dir / "research_input_packet.json", input_packet)
    _write_json(output_dir / "research_sources.json", {"sources": sources})
    _write_json(output_dir / "evidence_ledger.json", evidence_ledger)
    _write_json(output_dir / "coverage_matrix.json", evidence["coverage"])
    _write_json(output_dir / "contradictions.json", evidence["contradictions"])

    source_packet = [dict(row) for row in sources if row.get("opened") or row.get("snippet")]
    valuation_source_packet = select_valuation_sources(evidence, source_packet)
    _write_json(
        output_dir / "valuation_source_packet.json",
        {"sources": valuation_source_packet},
    )
    valuation_case, compiled, compiled_ok = engine._compile_case(
        snapshot=snapshot,
        evidence=evidence,
        source_packet=valuation_source_packet,
        input_packet=input_packet,
        output_dir=output_dir,
    )
    _write_json(output_dir / "valuation_case.json", valuation_case)
    _write_json(output_dir / "valuation_compiled.json", compiled)

    report = prior_report
    review: dict[str, Any] = {
        "publishable": False,
        "major_issues": [
            {
                "category": "valuation",
                "description": "Refined deterministic valuation did not compile.",
                "correction": "Retain the prior no-target conclusion.",
            }
        ],
        "minor_issues": [],
    }
    if compiled_ok:
        replacement_instruction = {
            "publishable": False,
            "major_issues": [
                {
                    "category": "superseded_valuation",
                    "description": (
                        "The prior draft says the valuation compiler failed. It is now superseded by "
                        "the supplied valid compiler output. Remove every no-target/compiler-failure "
                        "statement and rebuild all valuation, sensitivity, decision and control sections "
                        "from the valid case. Preserve the researched business analysis and citations."
                    ),
                    "correction": "Use the compiler-owned values exactly and state the refinement provenance.",
                }
            ],
            "minor_issues": [],
        }
        report = engine._write_report(
            snapshot=snapshot,
            mandate=mandate,
            plan=plan,
            evidence=evidence,
            source_packet=source_packet,
            compiled=compiled,
            valuation_case=valuation_case,
            compiled_ok=True,
            draft=None,
            review=replacement_instruction,
        )
        review = engine._review_report(
            snapshot=snapshot,
            evidence=evidence,
            compiled=compiled,
            valuation_case=valuation_case,
            report=report,
        )
        _write_json(output_dir / "prepublication_review_initial.json", review)
        if not review.get("publishable") or review.get("major_issues"):
            report = engine._write_report(
                snapshot=snapshot,
                mandate=mandate,
                plan=plan,
                evidence=evidence,
                source_packet=source_packet,
                compiled=compiled,
                valuation_case=valuation_case,
                compiled_ok=True,
                draft=report,
                review=review,
            )
            review = engine._review_report(
                snapshot=snapshot,
                evidence=evidence,
                compiled=compiled,
                valuation_case=valuation_case,
                report=report,
            )
        _write_json(output_dir / "prepublication_review_final.json", review)

    report_path = output_dir / "research_report.md"
    report_path.write_text(report.rstrip() + "\n", encoding="utf-8")
    for source in sources:
        url = str(source.get("url") or "").strip()
        source["cited"] = bool(url and url in report)
    _write_json(output_dir / "research_sources.json", {"sources": sources})
    quality_result = evaluate_run_artifacts(output_dir)
    quality_path = write_quality_report(output_dir, quality_result)
    review_passed = bool(review.get("publishable") and not (review.get("major_issues") or []))
    hard_review_blockers = review_hard_blockers(review)
    target_usable = bool(compiled_ok and not hard_review_blockers)
    status = "red" if not target_usable else ("green" if review_passed and quality_result.publication_status == "green" else "amber")
    _write_json(
        output_dir / "research_grade.json",
        {
            "version": "deep-research-grade-v2",
            "publication_status": status,
            "target_usable": target_usable,
            "research_quality": quality_result.to_dict(),
            "valuation_quality": {
                "compiler_passed": compiled_ok,
                "prepublication_review_passed": review_passed,
                "major_issues": review.get("major_issues") or [],
                "hard_blockers": hard_review_blockers,
                "minor_issues": review.get("minor_issues") or [],
            },
        },
    )
    completed_at = engine.now()
    manifest = {
        "engine": ENGINE_VERSION,
        "mode": "valuation-and-publication-refinement",
        "run_id": refinement_id,
        "parent_run": str(source_dir),
        "ticker": snapshot.ticker,
        "started_at": _iso(started_at),
        "completed_at": _iso(completed_at),
        "duration_seconds": round((completed_at - started_at).total_seconds(), 3),
        "source_research_reused": True,
        "source_research_sha256": hashlib.sha256(
            json.dumps(evidence, sort_keys=True).encode("utf-8")
        ).hexdigest(),
        "valuation_compiled": compiled_ok,
        "publication_status": status,
        "target_usable": target_usable,
        "research_quality_score": quality_result.score,
        "prepublication_review_passed": review_passed,
        "usage_and_cost": engine.usage.to_dict(),
    }
    manifest_path = output_dir / "research_manifest.json"
    _write_json(manifest_path, manifest)
    return DeepSeekResearchResult(
        run_id=refinement_id,
        ticker=snapshot.ticker,
        output_dir=output_dir,
        report_path=report_path,
        manifest_path=manifest_path,
        quality_path=quality_path,
    )
