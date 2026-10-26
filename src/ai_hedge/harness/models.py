from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class ClaimKind(str, Enum):
    FACT = "FACT"
    ASSUMPTION = "ASSUMPTION"
    INFERENCE = "INFERENCE"
    CONCLUSION = "CONCLUSION"


class ClaimStatus(str, Enum):
    PROPOSED = "PROPOSED"
    VERIFIED = "VERIFIED"
    DISPUTED = "DISPUTED"
    REJECTED = "REJECTED"
    STALE = "STALE"


class RelationKind(str, Enum):
    SUPPORTS = "supports"
    CONTRADICTS = "contradicts"
    DERIVES_FROM = "derives_from"
    SUPERSEDES = "supersedes"
    QUALIFIES = "qualifies"


class ResearchBudget(StrictModel):
    max_duration_seconds: int = Field(default=7_200, ge=60, le=10_800)
    max_gap_cycles: int = Field(default=3, ge=0, le=4)
    max_search_queries: int = Field(default=18, ge=0, le=30)
    max_cost_usd: float = Field(default=10.0, gt=0, le=25.0)


class ResearchSource(StrictModel):
    id: str = Field(default_factory=new_id)
    canonical_uri: str
    source_type: str
    title: str = ""
    publisher: str = ""
    published_at: str | None = None
    retrieved_at: datetime = Field(default_factory=utc_now)
    content_sha256: str
    content_pointer: str | None = None
    authority_score: float = Field(default=0.5, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvidenceItem(StrictModel):
    id: str = Field(default_factory=new_id)
    source_id: str
    excerpt: str
    locator: str
    language: str = "en"
    extraction_method: str = "deterministic"
    evidence_quality: float = Field(default=0.5, ge=0, le=1)
    content_sha256: str


class ResearchClaim(StrictModel):
    id: str = Field(default_factory=new_id)
    kind: ClaimKind
    status: ClaimStatus = ClaimStatus.PROPOSED
    statement: str
    subject: str
    predicate: str
    canonical_key: str
    value: Any = None
    unit: str | None = None
    currency: str | None = None
    period: str | None = None
    as_of: str | None = None
    confidence: float = Field(default=0.5, ge=0, le=1)
    critical: bool = False
    origin_stage: str
    origin_type: Literal["external", "computed", "model", "human"]
    evidence_ids: list[str] = Field(default_factory=list)
    source_score: float = Field(default=0.5, ge=0, le=1)
    selected: bool = False

    @field_validator("canonical_key")
    @classmethod
    def canonical_key_must_be_normalized(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized or " " in normalized:
            raise ValueError("canonical_key must be a non-empty normalized key")
        return normalized


class ClaimRelation(StrictModel):
    id: str = Field(default_factory=new_id)
    from_claim_id: str
    to_claim_id: str
    relation: RelationKind
    rationale: str = ""


class ContradictionCase(StrictModel):
    id: str = Field(default_factory=new_id)
    canonical_key: str
    claim_ids: list[str]
    critical: bool
    status: Literal["open", "provisional", "resolved"] = "open"
    selected_claim_id: str | None = None
    rationale: str = ""
    candidate_values: list[Any] = Field(default_factory=list)


class StageRun(StrictModel):
    id: str = Field(default_factory=new_id)
    stage_key: str
    attempt: int = Field(default=1, ge=1)
    status: Literal["running", "completed", "failed", "skipped"] = "running"
    dependency_stage_ids: list[str] = Field(default_factory=list)
    input_sha256: str
    output_sha256: str | None = None
    prompt_version: str | None = None
    model_id: str | None = None
    provider_id: str | None = None
    code_version: str | None = None
    started_at: datetime = Field(default_factory=utc_now)
    finished_at: datetime | None = None
    duration_ms: int | None = None
    cost_usd: float = 0.0
    error: str = ""


class SensitivityScenario(StrictModel):
    id: str = Field(default_factory=new_id)
    contradiction_id: str
    canonical_key: str
    candidate_claim_id: str
    candidate_value: Any
    selected: bool
    impact_status: Literal["selected_input", "alternative_input"]
    calculation_status: Literal["pending", "calculated", "not_applicable"] = "pending"
    baseline_target_price: float | None = None
    scenario_target_price: float | None = None
    target_impact_pct: float | None = None


class ResearchState(StrictModel):
    run_id: str = Field(default_factory=new_id)
    job_id: str | None = None
    ticker: str
    workspace: str
    engine_id: str
    engine_version: str
    harness_schema_version: str
    run_mode: Literal["live", "shadow", "replay"] = "live"
    baseline_research_run_id: UUID | None = None
    status: Literal["running", "completed", "failed", "budget_exhausted"] = "running"
    quality_status: Literal["green", "amber_conflict", "red", "budget_exhausted"] = "green"
    automation_eligible: bool = True
    budget: ResearchBudget = Field(default_factory=ResearchBudget)
    config_snapshot: dict[str, Any] = Field(default_factory=dict)
    sources: list[ResearchSource] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    claims: list[ResearchClaim] = Field(default_factory=list)
    relations: list[ClaimRelation] = Field(default_factory=list)
    contradictions: list[ContradictionCase] = Field(default_factory=list)
    stages: list[StageRun] = Field(default_factory=list)
    sensitivity_scenarios: list[SensitivityScenario] = Field(default_factory=list)
    queries_used: int = 0
    observed_cost_usd: float = 0.0
    quality_notes: list[str] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=utc_now)
    finished_at: datetime | None = None
    errors: list[str] = Field(default_factory=list)
