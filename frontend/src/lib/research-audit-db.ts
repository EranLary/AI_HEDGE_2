import { getSql } from "@/lib/db";

export type ResearchAudit = {
  run: {
    id: string;
    ticker: string;
    engine_id: "deterministic_v1" | "hybrid_v1";
    engine_version: string;
    harness_schema_version: string;
    run_mode: "live" | "shadow" | "replay";
    baseline_research_run_id: string | null;
    status: string;
    quality_status: "green" | "amber_conflict" | "red" | "budget_exhausted";
    automation_eligible: boolean;
    budget: Record<string, unknown>;
    config_snapshot: Record<string, unknown>;
    queries_used: number;
    observed_cost_usd: number;
    started_at: string;
    finished_at: string | null;
  };
  stages: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  claims: Array<Record<string, unknown> & { evidence_ids: string[] }>;
  relations: Array<Record<string, unknown>>;
  contradictions: Array<Record<string, unknown>>;
  sensitivity_scenarios: Array<Record<string, unknown>>;
};

export async function fetchResearchAudit(reportId: string): Promise<ResearchAudit | null> {
  const sql = getSql();
  if (!sql) return null;
  const runRows = (await sql`
    SELECT rr.id::text AS id, rr.ticker, rr.engine_id, rr.engine_version,
           rr.harness_schema_version, rr.run_mode,
           rr.baseline_research_run_id::text AS baseline_research_run_id,
           rr.status, rr.quality_status,
           rr.automation_eligible, rr.budget, rr.config_snapshot,
           rr.queries_used, rr.observed_cost_usd::float8 AS observed_cost_usd,
           rr.started_at::text AS started_at, rr.finished_at::text AS finished_at
      FROM reports r
      JOIN research_runs rr ON rr.id = r.research_run_id
     WHERE r.id = ${reportId}::uuid AND r.deleted_at IS NULL
     LIMIT 1;
  `) as unknown as ResearchAudit["run"][];
  const run = runRows[0];
  if (!run) return null;

  const [stages, sources, evidence, claims, relations, contradictions, sensitivityScenarios] = await Promise.all([
    sql`SELECT id::text, stage_key, attempt, status, dependency_stage_ids, input_sha256,
               output_sha256, prompt_version, model_id, provider_id, code_version,
               started_at::text, finished_at::text, duration_ms, cost_usd::float8, error
          FROM research_stage_runs WHERE research_run_id = ${run.id}::uuid ORDER BY started_at, stage_key`,
    sql`SELECT id::text, canonical_uri, source_type, title, publisher, published_at,
               retrieved_at::text, content_sha256, content_pointer, authority_score::float8, metadata
          FROM research_sources WHERE research_run_id = ${run.id}::uuid ORDER BY authority_score DESC, retrieved_at`,
    sql`SELECT id::text, source_id::text, excerpt, locator, language, extraction_method,
               evidence_quality::float8, content_sha256
          FROM research_evidence WHERE research_run_id = ${run.id}::uuid ORDER BY evidence_quality DESC, id`,
    sql`SELECT c.id::text, c.kind, c.status, c.statement, c.subject, c.predicate,
               c.canonical_key, c.value, c.unit, c.currency, c.period, c.as_of,
               c.confidence::float8, c.critical, c.origin_stage, c.origin_type,
               c.source_score::float8, c.selected,
               coalesce(jsonb_agg(ce.evidence_id::text) FILTER (WHERE ce.evidence_id IS NOT NULL), '[]'::jsonb) AS evidence_ids
          FROM research_claims c
          LEFT JOIN research_claim_evidence ce ON ce.claim_id = c.id
         WHERE c.research_run_id = ${run.id}::uuid
         GROUP BY c.id ORDER BY c.critical DESC, c.selected DESC, c.canonical_key`,
    sql`SELECT id::text, from_claim_id::text, to_claim_id::text, relation, rationale
          FROM research_claim_relations WHERE research_run_id = ${run.id}::uuid ORDER BY relation, id`,
    sql`SELECT id::text, canonical_key, claim_ids, critical, status,
               selected_claim_id::text, rationale, candidate_values
          FROM research_contradictions WHERE research_run_id = ${run.id}::uuid ORDER BY critical DESC, canonical_key`,
    sql`SELECT id::text, contradiction_id::text, canonical_key, candidate_claim_id::text,
               candidate_value, selected, impact_status, calculation_status,
               baseline_target_price::float8, scenario_target_price::float8,
               target_impact_pct::float8
          FROM research_sensitivity_scenarios WHERE research_run_id = ${run.id}::uuid ORDER BY canonical_key, selected DESC`,
  ]);

  return {
    run,
    stages: stages as Array<Record<string, unknown>>,
    sources: sources as Array<Record<string, unknown>>,
    evidence: evidence as Array<Record<string, unknown>>,
    claims: claims as ResearchAudit["claims"],
    relations: relations as Array<Record<string, unknown>>,
    contradictions: contradictions as Array<Record<string, unknown>>,
    sensitivity_scenarios: sensitivityScenarios as Array<Record<string, unknown>>,
  };
}
