from __future__ import annotations

from psycopg.types.json import Jsonb

from ai_hedge.harness.models import ResearchState

from .connection import get_conn


def persist_research_state(state: ResearchState) -> tuple[str | None, str | None]:
    """Persist a research ledger; detail rows are insert-only and retry-safe."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO research_runs (
                        id, job_id, ticker, workspace, engine_id, engine_version,
                        harness_schema_version, run_mode, baseline_research_run_id,
                        status, quality_status,
                        automation_eligible, budget, config_snapshot, queries_used,
                        observed_cost_usd, errors, started_at, finished_at
                    ) VALUES (
                        %(id)s::uuid, %(job_id)s, %(ticker)s, %(workspace)s,
                        %(engine_id)s, %(engine_version)s, %(harness_schema_version)s,
                        %(run_mode)s, %(baseline_research_run_id)s::uuid,
                        %(status)s, %(quality_status)s, %(automation_eligible)s,
                        %(budget)s, %(config_snapshot)s, %(queries_used)s,
                        %(observed_cost_usd)s, %(errors)s, %(started_at)s, %(finished_at)s
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        status = EXCLUDED.status,
                        quality_status = EXCLUDED.quality_status,
                        automation_eligible = EXCLUDED.automation_eligible,
                        queries_used = EXCLUDED.queries_used,
                        observed_cost_usd = EXCLUDED.observed_cost_usd,
                        errors = EXCLUDED.errors,
                        finished_at = EXCLUDED.finished_at
                    """,
                    {
                        "id": state.run_id,
                        "job_id": state.job_id,
                        "ticker": state.ticker,
                        "workspace": state.workspace,
                        "engine_id": state.engine_id,
                        "engine_version": state.engine_version,
                        "harness_schema_version": state.harness_schema_version,
                        "run_mode": state.run_mode,
                        "baseline_research_run_id": state.baseline_research_run_id,
                        "status": state.status,
                        "quality_status": state.quality_status,
                        "automation_eligible": state.automation_eligible,
                        "budget": Jsonb(state.budget.model_dump(mode="json")),
                        "config_snapshot": Jsonb(state.config_snapshot),
                        "queries_used": state.queries_used,
                        "observed_cost_usd": state.observed_cost_usd,
                        "errors": Jsonb(state.errors),
                        "started_at": state.started_at,
                        "finished_at": state.finished_at,
                    },
                )
                for row in state.stages:
                    cur.execute(
                        """INSERT INTO research_stage_runs (
                            id, research_run_id, stage_key, attempt, status,
                            dependency_stage_ids, input_sha256, output_sha256,
                            prompt_version, model_id, provider_id, code_version,
                            started_at, finished_at, duration_ms, cost_usd, error
                        ) VALUES (
                            %(id)s::uuid, %(research_run_id)s::uuid, %(stage_key)s,
                            %(attempt)s, %(status)s, %(dependencies)s, %(input_sha256)s,
                            %(output_sha256)s, %(prompt_version)s, %(model_id)s,
                            %(provider_id)s, %(code_version)s, %(started_at)s,
                            %(finished_at)s, %(duration_ms)s, %(cost_usd)s, %(error)s
                        ) ON CONFLICT (id) DO NOTHING""",
                        {**row.model_dump(mode="python"), "research_run_id": state.run_id, "dependencies": Jsonb(row.dependency_stage_ids)},
                    )
                for row in state.sources:
                    cur.execute(
                        """INSERT INTO research_sources (
                            id, research_run_id, canonical_uri, source_type, title,
                            publisher, published_at, retrieved_at, content_sha256,
                            content_pointer, authority_score, metadata
                        ) VALUES (
                            %(id)s::uuid, %(research_run_id)s::uuid, %(canonical_uri)s,
                            %(source_type)s, %(title)s, %(publisher)s, %(published_at)s,
                            %(retrieved_at)s, %(content_sha256)s, %(content_pointer)s,
                            %(authority_score)s, %(metadata)s
                        ) ON CONFLICT (id) DO NOTHING""",
                        {**row.model_dump(mode="python"), "research_run_id": state.run_id, "metadata": Jsonb(row.metadata)},
                    )
                for row in state.evidence:
                    cur.execute(
                        """INSERT INTO research_evidence (
                            id, research_run_id, source_id, excerpt, locator, language,
                            extraction_method, evidence_quality, content_sha256
                        ) VALUES (
                            %(id)s::uuid, %(research_run_id)s::uuid, %(source_id)s::uuid,
                            %(excerpt)s, %(locator)s, %(language)s, %(extraction_method)s,
                            %(evidence_quality)s, %(content_sha256)s
                        ) ON CONFLICT (id) DO NOTHING""",
                        {**row.model_dump(mode="python"), "research_run_id": state.run_id},
                    )
                for row in state.claims:
                    cur.execute(
                        """INSERT INTO research_claims (
                            id, research_run_id, kind, status, statement, subject,
                            predicate, canonical_key, value, unit, currency, period,
                            as_of, confidence, critical, origin_stage, origin_type,
                            source_score, selected
                        ) VALUES (
                            %(id)s::uuid, %(research_run_id)s::uuid, %(kind)s, %(status)s,
                            %(statement)s, %(subject)s, %(predicate)s, %(canonical_key)s,
                            %(value)s, %(unit)s, %(currency)s, %(period)s, %(as_of)s,
                            %(confidence)s, %(critical)s, %(origin_stage)s, %(origin_type)s,
                            %(source_score)s, %(selected)s
                        ) ON CONFLICT (id) DO NOTHING""",
                        {
                            **row.model_dump(mode="python"),
                            "research_run_id": state.run_id,
                            "kind": row.kind.value,
                            "status": row.status.value,
                            "value": Jsonb(row.value),
                        },
                    )
                    for evidence_id in row.evidence_ids:
                        cur.execute(
                            """INSERT INTO research_claim_evidence (claim_id, evidence_id)
                               VALUES (%s::uuid, %s::uuid) ON CONFLICT DO NOTHING""",
                            (row.id, evidence_id),
                        )
                for row in state.relations:
                    cur.execute(
                        """INSERT INTO research_claim_relations (
                            id, research_run_id, from_claim_id, to_claim_id, relation, rationale
                        ) VALUES (%s::uuid, %s::uuid, %s::uuid, %s::uuid, %s, %s)
                        ON CONFLICT (id) DO NOTHING""",
                        (row.id, state.run_id, row.from_claim_id, row.to_claim_id, row.relation.value, row.rationale),
                    )
                for row in state.contradictions:
                    cur.execute(
                        """INSERT INTO research_contradictions (
                            id, research_run_id, canonical_key, claim_ids, critical,
                            status, selected_claim_id, rationale, candidate_values
                        ) VALUES (%s::uuid, %s::uuid, %s, %s, %s, %s, %s::uuid, %s, %s)
                        ON CONFLICT (id) DO NOTHING""",
                        (row.id, state.run_id, row.canonical_key, Jsonb(row.claim_ids), row.critical, row.status, row.selected_claim_id, row.rationale, Jsonb(row.candidate_values)),
                    )
                for row in state.sensitivity_scenarios:
                    cur.execute(
                        """INSERT INTO research_sensitivity_scenarios (
                            id, research_run_id, contradiction_id, canonical_key,
                            candidate_claim_id, candidate_value, selected, impact_status,
                            calculation_status, baseline_target_price,
                            scenario_target_price, target_impact_pct
                        ) VALUES (%s::uuid, %s::uuid, %s::uuid, %s, %s::uuid, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING""",
                        (
                            row.id, state.run_id, row.contradiction_id, row.canonical_key,
                            row.candidate_claim_id, Jsonb(row.candidate_value), row.selected,
                            row.impact_status, row.calculation_status,
                            row.baseline_target_price, row.scenario_target_price,
                            row.target_impact_pct,
                        ),
                    )
            conn.commit()
        return state.run_id, None
    except Exception as exc:  # noqa: BLE001 - report generation remains primary
        return None, f"{type(exc).__name__}: {exc}"
