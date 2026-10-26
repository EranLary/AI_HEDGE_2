-- Hybrid Research Harness: immutable engine identity, stage manifests, and
-- normalized provenance. Large source bodies remain in R2; Neon stores the
-- authoritative catalog, claims, evidence locators, and relationships.

CREATE TABLE IF NOT EXISTS research_runs (
    id uuid PRIMARY KEY,
    job_id text,
    ticker text NOT NULL,
    workspace text NOT NULL CHECK (workspace IN ('analysis', 'nasdaq100')),
    engine_id text NOT NULL CHECK (engine_id IN ('deterministic_v1', 'hybrid_v1')),
    engine_version text NOT NULL,
    harness_schema_version text NOT NULL,
    run_mode text NOT NULL DEFAULT 'live' CHECK (run_mode IN ('live', 'shadow', 'replay')),
    baseline_research_run_id uuid REFERENCES research_runs(id) ON DELETE SET NULL,
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'budget_exhausted')),
    quality_status text NOT NULL CHECK (quality_status IN ('green', 'amber_conflict', 'red', 'budget_exhausted')),
    automation_eligible boolean NOT NULL DEFAULT true,
    budget jsonb NOT NULL DEFAULT '{}'::jsonb,
    config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    queries_used int NOT NULL DEFAULT 0 CHECK (queries_used >= 0),
    observed_cost_usd numeric(12, 4) NOT NULL DEFAULT 0 CHECK (observed_cost_usd >= 0),
    errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS research_runs_job_engine_idx ON research_runs (job_id, engine_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS research_runs_ticker_idx ON research_runs (ticker, started_at DESC);

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS research_run_id uuid REFERENCES research_runs(id),
    ADD COLUMN IF NOT EXISTS engine_id text NOT NULL DEFAULT 'deterministic_v1',
    ADD COLUMN IF NOT EXISTS engine_version text NOT NULL DEFAULT '1.0.0',
    ADD COLUMN IF NOT EXISTS harness_schema_version text NOT NULL DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS research_quality_status text NOT NULL DEFAULT 'green',
    ADD COLUMN IF NOT EXISTS automation_eligible boolean NOT NULL DEFAULT true;

ALTER TABLE site_runs
    ADD COLUMN IF NOT EXISTS research_run_id uuid REFERENCES research_runs(id),
    ADD COLUMN IF NOT EXISTS engine_id text NOT NULL DEFAULT 'deterministic_v1',
    ADD COLUMN IF NOT EXISTS engine_version text NOT NULL DEFAULT '1.0.0',
    ADD COLUMN IF NOT EXISTS harness_schema_version text NOT NULL DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS research_quality_status text NOT NULL DEFAULT 'green',
    ADD COLUMN IF NOT EXISTS automation_eligible boolean NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_engine_id_check') THEN
        ALTER TABLE reports ADD CONSTRAINT reports_engine_id_check
            CHECK (engine_id IN ('deterministic_v1', 'hybrid_v1'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_research_quality_status_check') THEN
        ALTER TABLE reports ADD CONSTRAINT reports_research_quality_status_check
            CHECK (research_quality_status IN ('green', 'amber_conflict', 'red', 'budget_exhausted'));
    END IF;
    IF to_regclass('site_runs') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_runs_engine_id_check') THEN
        ALTER TABLE site_runs ADD CONSTRAINT site_runs_engine_id_check
            CHECK (engine_id IN ('deterministic_v1', 'hybrid_v1'));
    END IF;
    IF to_regclass('site_runs') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_runs_research_quality_status_check') THEN
        ALTER TABLE site_runs ADD CONSTRAINT site_runs_research_quality_status_check
            CHECK (research_quality_status IN ('green', 'amber_conflict', 'red', 'budget_exhausted'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS research_stage_runs (
    id uuid PRIMARY KEY,
    research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    stage_key text NOT NULL,
    attempt int NOT NULL CHECK (attempt >= 1),
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    dependency_stage_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    input_sha256 text NOT NULL,
    output_sha256 text,
    prompt_version text,
    model_id text,
    provider_id text,
    code_version text,
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    duration_ms int,
    cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
    error text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS research_stage_runs_run_idx ON research_stage_runs (research_run_id, started_at);

CREATE TABLE IF NOT EXISTS research_sources (
    id uuid PRIMARY KEY,
    research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    canonical_uri text NOT NULL,
    source_type text NOT NULL,
    title text NOT NULL DEFAULT '',
    publisher text NOT NULL DEFAULT '',
    published_at text,
    retrieved_at timestamptz NOT NULL,
    content_sha256 text NOT NULL,
    content_pointer text,
    authority_score numeric NOT NULL CHECK (authority_score BETWEEN 0 AND 1),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (research_run_id, canonical_uri, content_sha256)
);

CREATE TABLE IF NOT EXISTS research_evidence (
    id uuid PRIMARY KEY,
    research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    source_id uuid NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
    excerpt text NOT NULL,
    locator text NOT NULL,
    language text NOT NULL DEFAULT 'en',
    extraction_method text NOT NULL,
    evidence_quality numeric NOT NULL CHECK (evidence_quality BETWEEN 0 AND 1),
    content_sha256 text NOT NULL
);
CREATE INDEX IF NOT EXISTS research_evidence_source_idx ON research_evidence (source_id);

CREATE TABLE IF NOT EXISTS research_claims (
    id uuid PRIMARY KEY,
    research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('FACT', 'ASSUMPTION', 'INFERENCE', 'CONCLUSION')),
    status text NOT NULL CHECK (status IN ('PROPOSED', 'VERIFIED', 'DISPUTED', 'REJECTED', 'STALE')),
    statement text NOT NULL,
    subject text NOT NULL,
    predicate text NOT NULL,
    canonical_key text NOT NULL,
    value jsonb,
    unit text,
    currency text,
    period text,
    as_of text,
    confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    critical boolean NOT NULL DEFAULT false,
    origin_stage text NOT NULL,
    origin_type text NOT NULL CHECK (origin_type IN ('external', 'computed', 'model', 'human')),
    source_score numeric NOT NULL CHECK (source_score BETWEEN 0 AND 1),
    selected boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS research_claims_key_idx ON research_claims (research_run_id, canonical_key);

CREATE TABLE IF NOT EXISTS research_claim_evidence (
    claim_id uuid NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
    evidence_id uuid NOT NULL REFERENCES research_evidence(id) ON DELETE CASCADE,
    PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS research_claim_relations (
    id uuid PRIMARY KEY,
    research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    from_claim_id uuid NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
    to_claim_id uuid NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
    relation text NOT NULL CHECK (relation IN ('supports', 'contradicts', 'derives_from', 'supersedes', 'qualifies')),
    rationale text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS research_contradictions (
    id uuid PRIMARY KEY,
    research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    canonical_key text NOT NULL,
    claim_ids jsonb NOT NULL,
    critical boolean NOT NULL,
    status text NOT NULL CHECK (status IN ('open', 'provisional', 'resolved')),
    selected_claim_id uuid REFERENCES research_claims(id) ON DELETE SET NULL,
    rationale text NOT NULL DEFAULT '',
    candidate_values jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS research_sensitivity_scenarios (
    id uuid PRIMARY KEY,
    research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    contradiction_id uuid NOT NULL REFERENCES research_contradictions(id) ON DELETE CASCADE,
    canonical_key text NOT NULL,
    candidate_claim_id uuid NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
    candidate_value jsonb,
    selected boolean NOT NULL,
    impact_status text NOT NULL CHECK (impact_status IN ('selected_input', 'alternative_input')),
    calculation_status text NOT NULL DEFAULT 'pending' CHECK (calculation_status IN ('pending', 'calculated', 'not_applicable')),
    baseline_target_price numeric,
    scenario_target_price numeric,
    target_impact_pct numeric
);

CREATE OR REPLACE FUNCTION prevent_research_ledger_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'research ledger rows are append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'research_sources', 'research_evidence', 'research_claims',
        'research_claim_evidence', 'research_claim_relations',
        'research_contradictions', 'research_sensitivity_scenarios'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS research_ledger_append_only ON %I', relation_name);
        EXECUTE format(
            'CREATE TRIGGER research_ledger_append_only BEFORE UPDATE OR DELETE ON %I '
            'FOR EACH ROW EXECUTE FUNCTION prevent_research_ledger_mutation()',
            relation_name
        );
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS reports_research_run_idx ON reports (research_run_id) WHERE research_run_id IS NOT NULL;
