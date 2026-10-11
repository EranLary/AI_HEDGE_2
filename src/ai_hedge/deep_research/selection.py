from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Optional


_AUDIT_PATTERN = re.compile(r"^research_audit(?:_repair_(\d+))?\.json$")


@dataclass(frozen=True)
class CandidateScore:
    candidate: str
    report_filename: str
    audit_filename: str
    quality_filename: str
    semantic_score: int
    structural_score: int
    structural_passed: bool
    usable_target: bool
    critical_issues: int
    major_issues: int
    minor_issues: int
    valuation_compiled: bool
    publication_ready: bool
    target_price: Optional[float]
    recommendation: Optional[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _load_json(path: Path) -> Mapping[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, Mapping) else {}


def _candidate_paths(run_dir: Path, attempt: Optional[int]) -> tuple[Path, Path, Path]:
    suffix = "" if attempt is None else f"_repair_{attempt}"
    return (
        run_dir / f"research_report{suffix}.md",
        run_dir / f"research_audit{suffix}.json",
        run_dir / f"research_quality{suffix}.json",
    )


def score_candidate(run_dir: Path, attempt: Optional[int]) -> CandidateScore:
    report_path, audit_path, quality_path = _candidate_paths(run_dir, attempt)
    audit = _load_json(audit_path)
    quality = _load_json(quality_path)
    suffix = "" if attempt is None else f"_repair_{attempt}"
    compiled_path = run_dir / f"valuation_compiled{suffix}.json"
    compiled_payload = _load_json(compiled_path) if compiled_path.exists() else {}
    valuation_compiled = bool(compiled_payload.get("valid"))
    issues = [row for row in audit.get("issues") or [] if isinstance(row, Mapping)]
    counts = {
        severity: sum(1 for row in issues if row.get("severity") == severity)
        for severity in ("critical", "major", "minor")
    }
    arithmetic = audit.get("deterministic_arithmetic")
    arithmetic = arithmetic if isinstance(arithmetic, Mapping) else {}
    valuation = audit.get("valuation")
    valuation = valuation if isinstance(valuation, Mapping) else {}
    semantic_score = int(audit.get("overall_quality_score") or 0)
    structural_score = int(quality.get("score") or 0)
    structural_passed = bool(quality.get("passed"))
    usable_target = bool(arithmetic.get("usable_target"))
    ready = (
        structural_passed
        and usable_target
        and semantic_score >= 85
        and valuation_compiled
    )
    target = valuation.get("target_price")
    target_price = float(target) if isinstance(target, (int, float)) else None
    recommendation = valuation.get("recommendation")
    return CandidateScore(
        candidate="base" if attempt is None else f"repair_{attempt}",
        report_filename=report_path.name,
        audit_filename=audit_path.name,
        quality_filename=quality_path.name,
        semantic_score=semantic_score,
        structural_score=structural_score,
        structural_passed=structural_passed,
        usable_target=usable_target,
        critical_issues=counts["critical"],
        major_issues=counts["major"],
        minor_issues=counts["minor"],
        valuation_compiled=valuation_compiled,
        publication_ready=ready,
        target_price=target_price,
        recommendation=str(recommendation) if recommendation else None,
    )


def select_best_candidate(run_dir: Path) -> dict[str, Any]:
    run_path = Path(run_dir)
    attempts: set[Optional[int]] = set()
    for audit_path in run_path.glob("research_audit*.json"):
        match = _AUDIT_PATTERN.match(audit_path.name)
        if match:
            attempts.add(int(match.group(1)) if match.group(1) else None)

    candidates: list[CandidateScore] = []
    for attempt in sorted(attempts, key=lambda value: -1 if value is None else value):
        report_path, audit_path, quality_path = _candidate_paths(run_path, attempt)
        if report_path.exists() and audit_path.exists() and quality_path.exists():
            candidates.append(score_candidate(run_path, attempt))
    if not candidates:
        raise FileNotFoundError(f"No complete audited candidates found in {run_path}")

    best = max(
        candidates,
        key=lambda row: (
            row.publication_ready,
            row.valuation_compiled,
            row.usable_target,
            -row.critical_issues,
            -row.major_issues,
            row.semantic_score,
            row.structural_passed,
            row.structural_score,
            -row.minor_issues,
        ),
    )
    payload = {
        "publication_ready": best.publication_ready,
        "selected_candidate": best.candidate,
        "selected_report": best.report_filename,
        "selection_reason": (
            "Highest publication-readiness, blocker, semantic-quality, and structural-quality rank."
        ),
        "candidates": [row.to_dict() for row in candidates],
    }
    (run_path / "research_selection.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload
