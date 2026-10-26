from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Mapping
from uuid import NAMESPACE_URL, uuid5

from .engine import EngineDescriptor
from .models import (
    ClaimKind,
    ClaimRelation,
    ClaimStatus,
    ContradictionCase,
    EvidenceItem,
    RelationKind,
    ResearchBudget,
    ResearchClaim,
    ResearchSource,
    ResearchState,
    SensitivityScenario,
    StageRun,
    utc_now,
)


CRITICAL_KEYS = {
    "company.currency",
    "company.financial_currency",
    "company.price_currency",
    "valuation.shares_outstanding",
    "valuation.market_cap",
    "valuation.total_debt",
    "valuation.total_cash",
    "financial.revenue",
    "financial.net_income",
    "financial.free_cash_flow",
}
WEB_SEARCHES_PER_CYCLE = 6

_KEY_ALIASES = {
    "shares_outstanding": "valuation.shares_outstanding",
    "sharesoutstanding": "valuation.shares_outstanding",
    "market_cap": "valuation.market_cap",
    "marketcap": "valuation.market_cap",
    "total_debt": "valuation.total_debt",
    "totaldebt": "valuation.total_debt",
    "total_cash": "valuation.total_cash",
    "totalcash": "valuation.total_cash",
    "free_cash_flow": "financial.free_cash_flow",
    "freecashflow": "financial.free_cash_flow",
    "revenue": "financial.revenue",
    "total_revenue": "financial.revenue",
    "totalrevenue": "financial.revenue",
    "net_income": "financial.net_income",
    "netincome": "financial.net_income",
    "currency": "company.currency",
    "financial_currency": "company.financial_currency",
    "price_currency": "company.price_currency",
}


def _json_default(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=_json_default)


def sha256_text(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def stable_record_id(run_id: str, record_type: str, *parts: object) -> str:
    identity = ":".join(["ai-hedge", run_id, record_type, *(str(part) for part in parts)])
    return str(uuid5(NAMESPACE_URL, identity))


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _equivalent(left: Any, right: Any) -> bool:
    left_number = _finite_number(left)
    right_number = _finite_number(right)
    if left_number is not None and right_number is not None:
        return math.isclose(left_number, right_number, rel_tol=0.005, abs_tol=1e-9)
    return str(left or "").strip().casefold() == str(right or "").strip().casefold()


def _claims_equivalent(left: ResearchClaim, right: ResearchClaim) -> bool:
    if left.unit and right.unit and left.unit.casefold() != right.unit.casefold():
        return False
    if left.currency and right.currency and left.currency.casefold() != right.currency.casefold():
        return False
    return _equivalent(left.value, right.value)


def _period_from_path(path: str) -> str | None:
    match = re.search(r"\b(20\d{2}(?:[-_/]\d{1,2}(?:[-_/]\d{1,2})?)?)\b", path)
    return match.group(1).replace("_", "-").replace("/", "-") if match else None


def _web_authority(item: Mapping[str, Any]) -> float:
    text = " ".join(
        str(item.get(key) or "").lower()
        for key in ("url", "publisher", "title")
    )
    if any(marker in text for marker in ("sec.gov", "maya.tase.co.il", "investor relations", "annual report")):
        return 0.9
    if any(marker in text for marker in ("reuters", "bloomberg", "wall street journal", "financial times")):
        return 0.72
    return 0.55


def _budget_from_env() -> ResearchBudget:
    def integer(name: str, default: int) -> int:
        try:
            return int(str(os.getenv(name, default)).strip())
        except Exception:
            return default

    def decimal(name: str, default: float) -> float:
        try:
            return float(str(os.getenv(name, default)).strip())
        except Exception:
            return default

    return ResearchBudget(
        max_duration_seconds=integer("HYBRID_MAX_DURATION_SECONDS", 7_200),
        max_gap_cycles=integer("HYBRID_MAX_GAP_CYCLES", 3),
        max_search_queries=integer("HYBRID_MAX_SEARCH_QUERIES", 18),
        max_cost_usd=decimal("HYBRID_MAX_COST_USD", 10.0),
    )


class HarnessSession:
    def __init__(
        self,
        *,
        descriptor: EngineDescriptor,
        ticker: str,
        workspace: str,
        output_dir: Path,
        job_id: str | None,
        code_version: str | None = None,
    ) -> None:
        self.descriptor = descriptor
        self.output_dir = output_dir
        self._started_monotonic = time.monotonic()
        self._source_contents: dict[str, str] = {}
        self._valuation_outputs: dict[str, Any] = {}
        budget = _budget_from_env()
        run_mode = str(os.getenv("HYBRID_RUN_MODE", "live") or "live").strip().lower()
        if run_mode not in {"live", "shadow", "replay"}:
            raise ValueError("HYBRID_RUN_MODE must be live, shadow, or replay.")
        baseline_research_run_id = str(
            os.getenv("HYBRID_BASELINE_RESEARCH_RUN_ID", "") or ""
        ).strip() or None
        self.state = ResearchState(
            ticker=ticker,
            workspace=workspace,
            job_id=job_id,
            engine_id=descriptor.engine_id,
            engine_version=descriptor.engine_version,
            harness_schema_version=descriptor.harness_schema_version,
            run_mode=run_mode,  # type: ignore[arg-type]
            baseline_research_run_id=baseline_research_run_id,
            budget=budget,
            config_snapshot={
                "engine_id": descriptor.engine_id,
                "engine_version": descriptor.engine_version,
                "harness_schema_version": descriptor.harness_schema_version,
                "budget": budget.model_dump(mode="json"),
                "code_version": code_version or os.getenv("GIT_SHA", "") or None,
                "run_mode": run_mode,
                "baseline_research_run_id": baseline_research_run_id,
            },
        )

    @property
    def is_hybrid(self) -> bool:
        return self.descriptor.hybrid

    @property
    def elapsed_seconds(self) -> float:
        return max(0.0, time.monotonic() - self._started_monotonic)

    def can_start_gap_cycle(self) -> bool:
        return (
            self.is_hybrid
            and self.state.queries_used + WEB_SEARCHES_PER_CYCLE <= self.state.budget.max_search_queries
            and self.elapsed_seconds < self.state.budget.max_duration_seconds
            and self.state.observed_cost_usd < self.state.budget.max_cost_usd
        )

    def budget_exhaustion_reason(self) -> str | None:
        if not self.is_hybrid:
            return None
        if self.elapsed_seconds >= self.state.budget.max_duration_seconds:
            return "Hybrid maximum duration was exhausted."
        if self.state.observed_cost_usd > self.state.budget.max_cost_usd:
            return "Hybrid maximum observed cost was exceeded."
        if self.state.queries_used > self.state.budget.max_search_queries:
            return "Hybrid maximum search-query count was exceeded."
        return None

    def remaining_seconds(self) -> int:
        return max(1, int(self.state.budget.max_duration_seconds - self.elapsed_seconds))

    def latest_stage_id(self, stage_key: str) -> str | None:
        return next(
            (stage.id for stage in reversed(self.state.stages) if stage.stage_key == stage_key),
            None,
        )

    def record_queries(self, count: int) -> None:
        self.state.queries_used += max(0, int(count))

    def record_cost(self, value: float) -> None:
        self.state.observed_cost_usd = max(self.state.observed_cost_usd, max(0.0, float(value or 0.0)))

    @contextmanager
    def stage(
        self,
        stage_key: str,
        inputs: Any,
        *,
        dependencies: list[str] | None = None,
        prompt_version: str | None = None,
        model_id: str | None = None,
        provider_id: str | None = None,
    ) -> Iterator[StageRun]:
        stage = StageRun(
            stage_key=stage_key,
            input_sha256=sha256_text(stable_json(inputs)),
            dependency_stage_ids=list(dependencies or []),
            prompt_version=prompt_version,
            model_id=model_id,
            provider_id=provider_id,
            code_version=str(self.state.config_snapshot.get("code_version") or "") or None,
        )
        self.state.stages.append(stage)
        started = time.perf_counter()
        try:
            yield stage
            if stage.status == "running":
                stage.status = "completed"
        except Exception as exc:
            stage.status = "failed"
            stage.error = f"{type(exc).__name__}: {exc}"[:2000]
            self.state.errors.append(f"{stage_key}: {stage.error}")
            raise
        finally:
            stage.finished_at = utc_now()
            stage.duration_ms = int((time.perf_counter() - started) * 1000)
            self._write_stage_checkpoint(stage)

    def _write_stage_checkpoint(self, stage: StageRun) -> None:
        checkpoint_dir = self.output_dir / "_harness" / "checkpoints"
        try:
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            payload = {
                "run_id": self.state.run_id,
                "stage": stage.model_dump(mode="json"),
                "state": self.state.model_dump(mode="json"),
            }
            serialized = json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default)
            (checkpoint_dir / f"{len(self.state.stages):03d}_{stage.id}.json").write_text(
                serialized,
                encoding="utf-8",
            )
            (checkpoint_dir / "latest.json").write_text(serialized, encoding="utf-8")
        except Exception as exc:
            self.state.errors.append(
                f"checkpoint {stage.stage_key}: {type(exc).__name__}: {exc}"[:2_000]
            )

    def complete_stage(self, stage: StageRun, output: Any) -> None:
        stage.output_sha256 = sha256_text(stable_json(output))

    def add_source(
        self,
        *,
        canonical_uri: str,
        source_type: str,
        content: str,
        title: str = "",
        publisher: str = "",
        published_at: str | None = None,
        content_pointer: str | None = None,
        authority_score: float = 0.5,
        metadata: dict[str, Any] | None = None,
    ) -> ResearchSource:
        uri = str(canonical_uri or "").strip()
        digest = sha256_text(content)
        for source in self.state.sources:
            if source.canonical_uri == uri and source.content_sha256 == digest:
                self._source_contents.setdefault(source.id, content)
                return source
        source = ResearchSource(
            canonical_uri=uri,
            source_type=source_type,
            title=title,
            publisher=publisher,
            published_at=published_at,
            content_sha256=digest,
            content_pointer=content_pointer,
            authority_score=authority_score,
            metadata=metadata or {},
        )
        if source.content_pointer is None:
            source.content_pointer = f"artifact://research-source-bodies-jsonl#{source.id}"
        self._source_contents[source.id] = content
        self.state.sources.append(source)
        return source

    def add_evidence(
        self,
        *,
        source_id: str,
        excerpt: str,
        locator: str,
        extraction_method: str,
        quality: float,
    ) -> EvidenceItem:
        clean_excerpt = str(excerpt or "").strip()
        evidence = EvidenceItem(
            source_id=source_id,
            excerpt=clean_excerpt,
            locator=str(locator or "").strip(),
            extraction_method=extraction_method,
            evidence_quality=quality,
            content_sha256=sha256_text(clean_excerpt),
        )
        self.state.evidence.append(evidence)
        return evidence

    def add_claim(
        self,
        *,
        kind: ClaimKind,
        statement: str,
        subject: str,
        predicate: str,
        canonical_key: str,
        value: Any,
        origin_stage: str,
        origin_type: str,
        evidence_ids: list[str],
        source_score: float,
        confidence: float,
        unit: str | None = None,
        currency: str | None = None,
        period: str | None = None,
        as_of: str | None = None,
        critical: bool | None = None,
    ) -> ResearchClaim:
        claim = ResearchClaim(
            kind=kind,
            statement=str(statement or "").strip(),
            subject=subject,
            predicate=predicate,
            canonical_key=canonical_key,
            value=value,
            origin_stage=origin_stage,
            origin_type=origin_type,  # type: ignore[arg-type]
            evidence_ids=evidence_ids,
            source_score=source_score,
            confidence=confidence,
            unit=unit,
            currency=currency,
            period=period,
            as_of=as_of,
            critical=canonical_key in CRITICAL_KEYS if critical is None else critical,
        )
        self.state.claims.append(claim)
        return claim

    def capture_provider_snapshot(
        self,
        *,
        info_dict: Mapping[str, Any],
        financial_dict: Mapping[str, Any],
        variables_dict: Mapping[str, Any],
    ) -> None:
        snapshots = {
            "info": dict(info_dict or {}),
            "financial": dict(financial_dict or {}),
            "variables": dict(variables_dict or {}),
        }
        source = self.add_source(
            canonical_uri=f"provider-snapshot://{self.state.ticker}/{self.state.run_id}",
            source_type="provider_snapshot",
            content=stable_json(snapshots),
            title=f"{self.state.ticker} deterministic provider snapshot",
            publisher="AI_HEDGE_2 providers",
            authority_score=0.72,
        )

        def walk(value: Any, path: str = "") -> Iterator[tuple[str, Any]]:
            if isinstance(value, Mapping):
                for key, nested in value.items():
                    next_path = f"{path}.{key}" if path else str(key)
                    yield from walk(nested, next_path)
            elif isinstance(value, (str, int, float)) and not isinstance(value, bool):
                yield path, value

        seen: set[tuple[str, str]] = set()
        for root_name, payload in snapshots.items():
            for path, value in walk(payload, root_name):
                leaf = path.rsplit(".", 1)[-1].strip().lower()
                canonical_key = _KEY_ALIASES.get(leaf)
                if leaf == "currency":
                    lowered_path = path.lower()
                    if "financial" in lowered_path:
                        canonical_key = "company.financial_currency"
                    elif "price" in lowered_path:
                        canonical_key = "company.price_currency"
                if not canonical_key:
                    continue
                # The legacy variables dictionary stores FX conversion factors
                # under ``price_currency`` / ``financial_currency``. They are
                # numeric rates, not ISO currency facts, and must never compete
                # with values such as ``USD`` in the canonical ledger.
                if canonical_key in {
                    "company.currency",
                    "company.financial_currency",
                    "company.price_currency",
                } and not isinstance(value, str):
                    continue
                # The provider payload includes trailing-period and averaged
                # market-cap observations. The valuation boundary consumes the
                # current, share-count-adjusted value in ``variables.market_cap``;
                # historical observations stay available in the immutable raw
                # source body without masquerading as same-period candidates.
                if canonical_key == "valuation.market_cap" and path.casefold() != "variables.market_cap":
                    continue
                fingerprint = (canonical_key, stable_json(value))
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                excerpt = stable_json({"path": path, "value": value})
                evidence = self.add_evidence(
                    source_id=source.id,
                    excerpt=excerpt,
                    locator=f"$.{path}",
                    extraction_method="json_path",
                    quality=0.72,
                )
                self.add_claim(
                    kind=ClaimKind.FACT,
                    statement=f"{canonical_key} is {value}",
                    subject=self.state.ticker,
                    predicate=canonical_key,
                    canonical_key=canonical_key,
                    value=value,
                    period=_period_from_path(path),
                    as_of=_period_from_path(path),
                    unit="shares" if canonical_key == "valuation.shares_outstanding" else None,
                    origin_stage="provider.snapshot",
                    origin_type="external",
                    evidence_ids=[evidence.id],
                    source_score=source.authority_score,
                    confidence=0.72,
                )

    def capture_share_count(self, payload: Mapping[str, Any]) -> None:
        if not payload:
            return
        source_type = str(payload.get("source_type") or "provider_fallback")
        evidence_excerpt = str(payload.get("evidence_excerpt") or payload.get("validation_note") or "").strip()
        source = self.add_source(
            canonical_uri=f"share-count://{self.state.ticker}/{self.state.run_id}",
            source_type=source_type,
            content=stable_json(dict(payload)),
            title=f"{self.state.ticker} share-count resolution",
            publisher="Official filing" if source_type == "official_filing" else "Provider fallback",
            published_at=str(payload.get("as_of_date") or "") or None,
            authority_score=0.98 if source_type == "official_filing" else 0.68,
        )
        selected = payload.get("selected_shares_outstanding")
        if selected is not None:
            evidence = self.add_evidence(
                source_id=source.id,
                excerpt=evidence_excerpt or stable_json({"selected_shares_outstanding": selected}),
                locator="$.selected_shares_outstanding",
                extraction_method="validated_share_count",
                quality=source.authority_score,
            )
            self.add_claim(
                kind=ClaimKind.FACT,
                statement=f"Total-company shares outstanding are {selected}",
                subject=self.state.ticker,
                predicate="shares_outstanding",
                canonical_key="valuation.shares_outstanding",
                value=selected,
                unit="shares",
                as_of=str(payload.get("as_of_date") or "") or None,
                origin_stage="share_count.verify",
                origin_type="external",
                evidence_ids=[evidence.id],
                source_score=source.authority_score,
                confidence=0.98 if source_type == "official_filing" else 0.68,
            )
        for name, value in dict(payload.get("provider_candidates") or {}).items():
            evidence = self.add_evidence(
                source_id=source.id,
                excerpt=stable_json({name: value}),
                locator=f"$.provider_candidates.{name}",
                extraction_method="provider_candidate",
                quality=0.6,
            )
            self.add_claim(
                kind=ClaimKind.FACT,
                statement=f"Provider candidate {name} reports {value} shares",
                subject=self.state.ticker,
                predicate="shares_outstanding",
                canonical_key="valuation.shares_outstanding",
                value=value,
                unit="shares",
                origin_stage="share_count.verify",
                origin_type="external",
                evidence_ids=[evidence.id],
                source_score=0.6,
                confidence=0.6,
            )

    def capture_web_research(self, payload: Mapping[str, Any], *, cycle: int) -> None:
        for index, item in enumerate(payload.get("sources") or []):
            if not isinstance(item, Mapping):
                continue
            content = str(item.get("content_excerpt") or item.get("snippet") or "").strip()
            if not content:
                continue
            authority_score = _web_authority(item)
            source = self.add_source(
                canonical_uri=str(item.get("url") or ""),
                source_type=str(item.get("kind") or "web"),
                content=content,
                title=str(item.get("title") or ""),
                publisher=str(item.get("publisher") or ""),
                published_at=str(item.get("published_at") or "") or None,
                authority_score=authority_score,
                metadata={"cycle": cycle, "query_ids": list(item.get("query_ids") or [])},
            )
            self.add_evidence(
                source_id=source.id,
                excerpt=content,
                locator=f"web-cycle:{cycle}:source:{index}",
                extraction_method="web_extract",
                quality=authority_score,
            )

    def capture_web_claims(
        self,
        payload: Mapping[str, Any],
        candidates: list[Any],
        *,
        cycle: int,
    ) -> None:
        sources = [source for source in payload.get("sources") or [] if isinstance(source, Mapping)]
        for candidate in candidates:
            index = int(candidate.source_index)
            if index < 0 or index >= len(sources):
                continue
            item = sources[index]
            content = str(item.get("content_excerpt") or item.get("snippet") or "").strip()
            if not content or str(candidate.quote) not in content:
                continue
            authority_score = _web_authority(item)
            source = self.add_source(
                canonical_uri=str(item.get("url") or ""),
                source_type=str(item.get("kind") or "web"),
                content=content,
                title=str(item.get("title") or ""),
                publisher=str(item.get("publisher") or ""),
                published_at=str(item.get("published_at") or "") or None,
                authority_score=authority_score,
                metadata={"cycle": cycle, "query_ids": list(item.get("query_ids") or [])},
            )
            evidence = self.add_evidence(
                source_id=source.id,
                excerpt=str(candidate.quote),
                locator=f"web-cycle:{cycle}:source:{index}:exact-quote",
                extraction_method="typed_web_claim_extractor",
                quality=authority_score,
            )
            self.add_claim(
                kind=ClaimKind.FACT,
                statement=str(candidate.statement),
                subject=self.state.ticker,
                predicate=str(candidate.canonical_key).rsplit(".", 1)[-1],
                canonical_key=str(candidate.canonical_key),
                value=candidate.value,
                unit=candidate.unit,
                currency=candidate.currency,
                period=candidate.period,
                as_of=candidate.as_of,
                origin_stage=f"web.claim_extraction.{cycle}",
                origin_type="model",
                evidence_ids=[evidence.id],
                source_score=authority_score,
                confidence=min(float(candidate.confidence), authority_score),
            )

    def gap_context(self) -> str:
        issues = self.valuation_readiness_issues()
        unresolved = [
            contradiction
            for contradiction in self.state.contradictions
            if contradiction.status != "resolved"
        ]
        lines = [*(f"- Required input gap: {issue}" for issue in issues)]
        lines.extend(
            f"- Unresolved {row.canonical_key}: candidates={row.candidate_values}"
            for row in unresolved
        )
        return "\n".join(lines)

    def capture_valuation_outputs(self, final_dict: Mapping[str, Any]) -> None:
        """Record deterministic valuation outputs and their explicit assumptions."""
        if not final_dict:
            return
        self._valuation_outputs = dict(final_dict)
        content = stable_json(dict(final_dict))
        source = self.add_source(
            canonical_uri=f"valuation-output://{self.state.ticker}/{self.state.run_id}",
            source_type="computed_valuation",
            content=content,
            title=f"{self.state.ticker} deterministic valuation outputs",
            publisher="AI_HEDGE_2 valuation engine",
            authority_score=1.0,
        )

        def add_output_claim(metric: str, kind: ClaimKind) -> None:
            payload = final_dict.get(metric)
            if not isinstance(payload, Mapping):
                return
            values = payload.get("Mean", payload.get("Overall"))
            value = values[0] if isinstance(values, (list, tuple)) and values else None
            if _finite_number(value) is None:
                return
            locator = f"$.{metric}.Mean[0]"
            evidence = self.add_evidence(
                source_id=source.id,
                excerpt=stable_json({"metric": metric, "mean": value}),
                locator=locator,
                extraction_method="deterministic_json_path",
                quality=1.0,
            )
            normalized_metric = re.sub(r"[^a-z0-9]+", "_", metric.lower()).strip("_")
            self.add_claim(
                kind=kind,
                statement=f"The deterministic valuation output for {metric} is {value}",
                subject=self.state.ticker,
                predicate=f"valuation_{normalized_metric}",
                canonical_key=f"valuation.output.{normalized_metric}",
                value=value,
                origin_stage="valuations",
                origin_type="computed",
                evidence_ids=[evidence.id],
                source_score=1.0,
                confidence=1.0,
                unit="price_per_share" if metric == "Prices" else None,
                critical=False,
            )

        add_output_claim("Prices", ClaimKind.CONCLUSION)
        add_output_claim("Revenue", ClaimKind.INFERENCE)
        add_output_claim("Net Income", ClaimKind.INFERENCE)
        add_output_claim("P/E", ClaimKind.INFERENCE)

        assumptions_seen = 0

        def walk_assumptions(value: Any, path: str = "$") -> Iterator[tuple[str, Any]]:
            if isinstance(value, Mapping):
                for key, nested in value.items():
                    next_path = f"{path}.{key}"
                    if "assumption" in str(key).lower() and isinstance(nested, (str, int, float, bool)):
                        yield next_path, nested
                    else:
                        yield from walk_assumptions(nested, next_path)
            elif isinstance(value, list):
                for index, nested in enumerate(value):
                    yield from walk_assumptions(nested, f"{path}[{index}]")

        for path, value in walk_assumptions(final_dict):
            if assumptions_seen >= 100:
                break
            assumptions_seen += 1
            evidence = self.add_evidence(
                source_id=source.id,
                excerpt=stable_json({"path": path, "value": value}),
                locator=path,
                extraction_method="assumption_field",
                quality=1.0,
            )
            normalized_path = re.sub(r"[^a-z0-9]+", ".", path.lower()).strip(".")
            self.add_claim(
                kind=ClaimKind.ASSUMPTION,
                statement=f"Valuation assumption at {path}: {value}",
                subject=self.state.ticker,
                predicate="valuation_assumption",
                canonical_key=f"valuation.assumption.{normalized_path}",
                value=value,
                origin_stage="valuations",
                origin_type="model",
                evidence_ids=[evidence.id],
                source_score=1.0,
                confidence=1.0,
                critical=False,
            )

    def apply_valuation_sensitivity(self, final_dict: Mapping[str, Any]) -> None:
        """Calculate exact denominator sensitivity for share-count conflicts."""
        prices = final_dict.get("Prices") if isinstance(final_dict, Mapping) else None
        values = prices.get("Mean", prices.get("Overall")) if isinstance(prices, Mapping) else None
        baseline = _finite_number(values[0]) if isinstance(values, (list, tuple)) and values else None
        scenarios_by_contradiction: dict[str, list[SensitivityScenario]] = {}
        for scenario in self.state.sensitivity_scenarios:
            scenarios_by_contradiction.setdefault(scenario.contradiction_id, []).append(scenario)
        for scenarios in scenarios_by_contradiction.values():
            selected = next((scenario for scenario in scenarios if scenario.selected), None)
            selected_input = _finite_number(selected.candidate_value) if selected else None
            for scenario in scenarios:
                scenario.baseline_target_price = baseline
                if baseline is None:
                    continue
                if scenario.selected:
                    scenario.calculation_status = "calculated"
                    scenario.scenario_target_price = baseline
                    scenario.target_impact_pct = 0.0
                    continue
                candidate_input = _finite_number(scenario.candidate_value)
                if (
                    scenario.canonical_key == "valuation.shares_outstanding"
                    and selected_input is not None
                    and selected_input > 0
                    and candidate_input is not None
                    and candidate_input > 0
                ):
                    scenario_price = baseline * selected_input / candidate_input
                    scenario.calculation_status = "calculated"
                    scenario.scenario_target_price = scenario_price
                    scenario.target_impact_pct = ((scenario_price - baseline) / baseline) * 100.0 if baseline else None

    def reconcile(self) -> None:
        self.state.relations = []
        self.state.contradictions = []
        self.state.sensitivity_scenarios = []
        if self.state.quality_status == "amber_conflict":
            self.state.quality_status = "green"
            self.state.automation_eligible = True
        for claim in self.state.claims:
            claim.selected = False
            claim.status = ClaimStatus.PROPOSED
        evidence_by_id = {row.id: row for row in self.state.evidence}
        grouped: dict[tuple[str, str], list[ResearchClaim]] = {}
        for claim in self.state.claims:
            dimension = (
                claim.canonical_key,
                str(claim.period or claim.as_of or ""),
            )
            grouped.setdefault(dimension, []).append(claim)

        def rank(claim: ResearchClaim) -> tuple[float, float, float, str]:
            evidence_quality = max(
                (evidence_by_id[evidence_id].evidence_quality for evidence_id in claim.evidence_ids if evidence_id in evidence_by_id),
                default=0.0,
            )
            completeness = sum(bool(value) for value in (claim.period or claim.as_of, claim.unit, claim.currency)) / 3.0
            score = (
                0.5 * claim.source_score
                + 0.25 * claim.confidence
                + 0.15 * evidence_quality
                + 0.10 * completeness
            )
            return score, claim.source_score, claim.confidence, claim.id

        for dimension, claims in grouped.items():
            canonical_key = dimension[0]
            ranked = sorted(claims, key=rank, reverse=True)
            selected = ranked[0]
            selected.selected = True
            selected.status = ClaimStatus.VERIFIED
            conflicts = [claim for claim in ranked[1:] if not _claims_equivalent(selected, claim)]
            for claim in ranked[1:]:
                if claim in conflicts:
                    claim.status = ClaimStatus.DISPUTED
                    self.state.relations.append(
                        ClaimRelation(
                            id=stable_record_id(
                                self.state.run_id,
                                "relation",
                                claim.id,
                                selected.id,
                                RelationKind.CONTRADICTS.value,
                            ),
                            from_claim_id=claim.id,
                            to_claim_id=selected.id,
                            relation=RelationKind.CONTRADICTS,
                            rationale="Canonical values differ beyond the deterministic tolerance.",
                        )
                    )
                else:
                    claim.status = ClaimStatus.VERIFIED
                    self.state.relations.append(
                        ClaimRelation(
                            id=stable_record_id(
                                self.state.run_id,
                                "relation",
                                claim.id,
                                selected.id,
                                RelationKind.SUPPORTS.value,
                            ),
                            from_claim_id=claim.id,
                            to_claim_id=selected.id,
                            relation=RelationKind.SUPPORTS,
                            rationale="Canonical values agree within the deterministic tolerance.",
                        )
                    )
            if not conflicts:
                continue
            critical = canonical_key in CRITICAL_KEYS or any(claim.critical for claim in claims)
            decisive = bool(
                critical
                and selected.source_score >= 0.9
                and all(selected.source_score - claim.source_score >= 0.15 for claim in conflicts)
            )
            contradiction = ContradictionCase(
                id=stable_record_id(self.state.run_id, "contradiction", *dimension),
                canonical_key=canonical_key,
                claim_ids=[claim.id for claim in ranked],
                critical=critical,
                status="resolved" if decisive else ("provisional" if critical else "open"),
                selected_claim_id=selected.id if critical else None,
                rationale=(
                    "Conflict resolved deterministically because a primary source materially outranks every alternative."
                    if decisive
                    else "Provisional value selected deterministically by source authority, evidence quality, completeness, and confidence."
                    if critical
                    else "Conflicting non-critical claims retained for audit."
                ),
                candidate_values=[claim.value for claim in ranked],
            )
            self.state.contradictions.append(contradiction)
            for claim in ranked:
                self.state.sensitivity_scenarios.append(
                    SensitivityScenario(
                        id=stable_record_id(
                            self.state.run_id,
                            "sensitivity",
                            contradiction.id,
                            claim.id,
                        ),
                        contradiction_id=contradiction.id,
                        canonical_key=canonical_key,
                        candidate_claim_id=claim.id,
                        candidate_value=claim.value,
                        selected=claim.id == selected.id,
                        impact_status="selected_input" if claim.id == selected.id else "alternative_input",
                    )
                )
            if critical and not decisive:
                self.state.quality_status = "amber_conflict"
                self.state.automation_eligible = False

    def valuation_readiness_issues(self) -> list[str]:
        """Return hard-stop reasons for Hybrid before the immutable valuation boundary."""
        if not self.is_hybrid:
            return []
        selected = [claim for claim in self.state.claims if claim.selected]
        issues: list[str] = []
        shares = [claim for claim in selected if claim.canonical_key == "valuation.shares_outstanding"]
        if not any(_finite_number(claim.value) is not None and float(claim.value) > 0 for claim in shares):
            issues.append("missing defensible total-company shares outstanding")
        currency_claim = next(
            (
                claim
                for claim in selected
                if claim.canonical_key in ("company.currency", "company.price_currency", "company.financial_currency")
            ),
            None,
        )
        if currency_claim is None or not str(currency_claim.value or "").strip():
            issues.append("missing defensible currency")
        return issues

    def context_markdown(self) -> str:
        if not self.is_hybrid:
            return ""
        selected = [claim for claim in self.state.claims if claim.selected]
        lines = [
            "## Hybrid Research State",
            "",
            "The following inputs are machine-traceable. Facts, assumptions, inferences, and conclusions must not be conflated.",
            "",
            "### Canonical Claims",
        ]
        if not selected:
            lines.append("- No canonical structured claims were available.")
        for claim in selected:
            qualifiers = [claim.kind.value, claim.status.value, f"confidence={claim.confidence:.2f}"]
            if claim.unit:
                qualifiers.append(f"unit={claim.unit}")
            if claim.currency:
                qualifiers.append(f"currency={claim.currency}")
            if claim.period:
                qualifiers.append(f"period={claim.period}")
            lines.append(f"- [{'; '.join(qualifiers)}] {claim.statement}")
        lines.extend(["", "### Unresolved Contradictions"])
        if not self.state.contradictions:
            lines.append("- None detected by the deterministic contradiction engine.")
        for contradiction in self.state.contradictions:
            lines.append(
                f"- {contradiction.canonical_key}: candidates={contradiction.candidate_values}; "
                f"status={contradiction.status}. {contradiction.rationale}"
            )
        return "\n".join(lines).strip()

    def mark_budget_exhausted(self, reason: str) -> None:
        self.state.status = "budget_exhausted"
        self.state.quality_status = "budget_exhausted"
        self.state.automation_eligible = False
        self.state.errors.append(reason)

    def finalize(self, *, success: bool = True) -> dict[str, str]:
        self.reconcile()
        if self._valuation_outputs:
            self.apply_valuation_sensitivity(self._valuation_outputs)
        if self.state.status == "running":
            self.state.status = "completed" if success else "failed"
        if not success and self.state.status != "budget_exhausted":
            self.state.quality_status = "red"
            self.state.automation_eligible = False
        self.state.finished_at = utc_now()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        prefix = self.state.ticker
        state_path = self.output_dir / f"{prefix}_research_state.json"
        manifest_path = self.output_dir / f"{prefix}_execution_manifest.json"
        ledger_path = self.output_dir / f"{prefix}_evidence_ledger.jsonl"
        contradictions_path = self.output_dir / f"{prefix}_contradictions.json"
        sensitivity_path = self.output_dir / f"{prefix}_valuation_sensitivity.json"
        source_bodies_path = self.output_dir / f"{prefix}_research_source_bodies.jsonl"
        checkpoint_latest_path = self.output_dir / "_harness" / "checkpoints" / "latest.json"

        state_path.write_text(self.state.model_dump_json(indent=2), encoding="utf-8")
        manifest_path.write_text(
            json.dumps(
                {
                    "run_id": self.state.run_id,
                    "engine": self.descriptor.__dict__,
                    "config_snapshot": self.state.config_snapshot,
                    "stages": [stage.model_dump(mode="json") for stage in self.state.stages],
                },
                ensure_ascii=False,
                indent=2,
                default=_json_default,
            ),
            encoding="utf-8",
        )
        ledger_rows = [
            *({"record_type": "source", **row.model_dump(mode="json")} for row in self.state.sources),
            *({"record_type": "evidence", **row.model_dump(mode="json")} for row in self.state.evidence),
            *({"record_type": "claim", **row.model_dump(mode="json")} for row in self.state.claims),
            *({"record_type": "relation", **row.model_dump(mode="json")} for row in self.state.relations),
        ]
        ledger_path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False, default=_json_default) for row in ledger_rows) + "\n",
            encoding="utf-8",
        )
        contradictions_path.write_text(
            json.dumps([row.model_dump(mode="json") for row in self.state.contradictions], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        sensitivity_path.write_text(
            json.dumps([row.model_dump(mode="json") for row in self.state.sensitivity_scenarios], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        source_bodies_path.write_text(
            "\n".join(
                json.dumps(
                    {"source_id": source_id, "content": content},
                    ensure_ascii=False,
                )
                for source_id, content in sorted(self._source_contents.items())
            )
            + ("\n" if self._source_contents else ""),
            encoding="utf-8",
        )
        return {
            "research_state_json": str(state_path.resolve()),
            "execution_manifest_json": str(manifest_path.resolve()),
            "evidence_ledger_jsonl": str(ledger_path.resolve()),
            "contradictions_json": str(contradictions_path.resolve()),
            "valuation_sensitivity_json": str(sensitivity_path.resolve()),
            "research_source_bodies_jsonl": str(source_bodies_path.resolve()),
            "checkpoint_latest_json": str(checkpoint_latest_path.resolve()) if checkpoint_latest_path.exists() else "",
        }
