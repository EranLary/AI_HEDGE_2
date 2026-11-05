CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0. Users: one row per signed-in Google account.
CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    google_sub    text NOT NULL UNIQUE,
    email         text NOT NULL UNIQUE,
    name          text,
    image_url     text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now()
);

-- 1. Dimension: one row per ticker the system has touched.
CREATE TABLE IF NOT EXISTS tickers (
    symbol            text PRIMARY KEY,
    company_name      text,
    exchange          text,
    currency          text,
    sector            text,
    industry          text,
    profile_source    text,
    profile_updated_at timestamptz,
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    last_analyzed_at  timestamptz,
    report_count      int  NOT NULL DEFAULT 0,
    is_supported      boolean NOT NULL DEFAULT true
);

-- 2. Report releases. A running Nasdaq release publishes each completed
-- report immediately; only active releases are eligible for portfolio refresh.
CREATE TABLE IF NOT EXISTS report_releases (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace     text NOT NULL CHECK (workspace IN ('analysis', 'nasdaq100')),
    release_key   text NOT NULL,
    status        text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'running', 'active')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    activated_at  timestamptz,
    coverage_complete boolean NOT NULL DEFAULT false,
    UNIQUE (workspace, release_key),
    CHECK (
        (status = 'staged' AND activated_at IS NULL)
        OR (status IN ('running', 'active') AND activated_at IS NOT NULL)
    )
);

-- 3. Slim "discoverable" report row -- what list pages query.
CREATE TABLE IF NOT EXISTS reports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              text NOT NULL REFERENCES tickers(symbol),
    user_id             uuid REFERENCES users(id) ON DELETE SET NULL,

    generated_at        timestamptz NOT NULL,
    dashboard_version   text NOT NULL,

    -- Denormalized for cheap list queries (no JSON deref).
    company_name        text,
    current_price       numeric,
    market_cap          numeric,
    currency            text,
    recommendation      text,                          -- LONG / SHORT / HOLD / null
    mean_target_price   numeric,
    median_target_price numeric,
    consensus_target_price numeric,
    consensus_allocation_pct numeric,
    consensus_score    numeric,
    consensus_basis    text CHECK (consensus_basis IN (
        'mean_median', 'mean_only', 'mean_median_sector_weighted',
        'mean_sector_weighted', 'median_sector_weighted', 'sector_weighted_only'
    )),

    visibility          text NOT NULL DEFAULT 'public',-- public | private | unlisted
    source              text NOT NULL,                 -- fly_backfill | cli | site
    source_run_id       text,
    origin_path         text,
    workspace           text NOT NULL DEFAULT 'analysis'
                        CHECK (workspace IN ('analysis', 'nasdaq100')),
    release_id          uuid REFERENCES report_releases(id),
    available_at        timestamptz NOT NULL DEFAULT now(),

    deleted_at          timestamptz,                   -- soft delete
    superseded_by_id    uuid REFERENCES reports(id),

    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (workspace = 'analysis' AND release_id IS NULL)
        OR (workspace = 'nasdaq100' AND release_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS reports_ticker_generated_idx
    ON reports (ticker, generated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_user_idx
    ON reports (user_id, generated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_recent_public_idx
    ON reports (generated_at DESC) WHERE deleted_at IS NULL AND visibility = 'public';

-- Dedup per (user, ticker, generated_at). NULL user_id is a single bucket
-- so two backfill rows for the same (ticker, generated_at) collide.
CREATE UNIQUE INDEX IF NOT EXISTS reports_workspace_dedup_idx
    ON reports (
        (coalesce(user_id::text, '')),
        workspace,
        (coalesce(release_id::text, '')),
        ticker,
        generated_at
    );

CREATE OR REPLACE FUNCTION validate_report_release_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    release_workspace text;
    release_status text;
BEGIN
    IF NEW.workspace = 'analysis' THEN
        IF NEW.release_id IS NOT NULL THEN
            RAISE EXCEPTION 'analysis reports cannot belong to a release';
        END IF;
        RETURN NEW;
    END IF;
    SELECT workspace, status INTO release_workspace, release_status
      FROM report_releases WHERE id = NEW.release_id
      FOR UPDATE;
    IF NOT FOUND OR release_workspace <> NEW.workspace THEN
        RAISE EXCEPTION 'report release does not match workspace';
    END IF;
    IF TG_OP = 'INSERT' AND release_status NOT IN ('staged', 'running') THEN
        RAISE EXCEPTION 'cannot add reports to an active release';
    END IF;
    IF TG_OP = 'UPDATE'
       AND (NEW.workspace IS DISTINCT FROM OLD.workspace OR NEW.release_id IS DISTINCT FROM OLD.release_id)
       AND release_status NOT IN ('staged', 'running') THEN
        RAISE EXCEPTION 'cannot move reports into an active release';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_validate_release ON reports;
CREATE TRIGGER reports_validate_release
BEFORE INSERT OR UPDATE ON reports
FOR EACH ROW EXECUTE FUNCTION validate_report_release_membership();

-- 4. Heavy content -- fetched only when a user opens a report.
CREATE TABLE IF NOT EXISTS report_artifacts (
    report_id           uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
    dashboard           jsonb NOT NULL,
    analysis_md         text  NOT NULL,
    prices_explain_md   text,
    analysis_md_source  text  NOT NULL DEFAULT 'txt',  -- md | txt | html | pdf
    r2_keys             jsonb                          -- {kind: r2_object_key}; NULL until Phase 1
);

-- Hybrid Research Harness. Large/raw bodies live in R2; these normalized rows
-- are the authoritative audit and provenance catalog.
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
    quality_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
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
END $$;

CREATE TABLE IF NOT EXISTS research_stage_runs (
    id uuid PRIMARY KEY, research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    stage_key text NOT NULL, attempt int NOT NULL CHECK (attempt >= 1),
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    dependency_stage_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    input_sha256 text NOT NULL, output_sha256 text, prompt_version text, model_id text,
    provider_id text, code_version text, started_at timestamptz NOT NULL,
    finished_at timestamptz, duration_ms int, cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
    error text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS research_stage_runs_run_idx ON research_stage_runs (research_run_id, started_at);

CREATE TABLE IF NOT EXISTS research_sources (
    id uuid PRIMARY KEY, research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    canonical_uri text NOT NULL, source_type text NOT NULL, title text NOT NULL DEFAULT '',
    publisher text NOT NULL DEFAULT '', published_at text, retrieved_at timestamptz NOT NULL,
    content_sha256 text NOT NULL, content_pointer text,
    authority_score numeric NOT NULL CHECK (authority_score BETWEEN 0 AND 1),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (research_run_id, canonical_uri, content_sha256)
);
CREATE TABLE IF NOT EXISTS research_evidence (
    id uuid PRIMARY KEY, research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    source_id uuid NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
    excerpt text NOT NULL, locator text NOT NULL, language text NOT NULL DEFAULT 'en',
    extraction_method text NOT NULL, evidence_quality numeric NOT NULL CHECK (evidence_quality BETWEEN 0 AND 1),
    content_sha256 text NOT NULL
);
CREATE INDEX IF NOT EXISTS research_evidence_source_idx ON research_evidence (source_id);
CREATE TABLE IF NOT EXISTS research_claims (
    id uuid PRIMARY KEY, research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('FACT', 'ASSUMPTION', 'INFERENCE', 'CONCLUSION')),
    status text NOT NULL CHECK (status IN ('PROPOSED', 'VERIFIED', 'DISPUTED', 'REJECTED', 'STALE')),
    statement text NOT NULL, subject text NOT NULL, predicate text NOT NULL, canonical_key text NOT NULL,
    value jsonb, unit text, currency text, period text, as_of text,
    confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1), critical boolean NOT NULL DEFAULT false,
    origin_stage text NOT NULL,
    origin_type text NOT NULL CHECK (origin_type IN ('external', 'computed', 'model', 'human')),
    source_score numeric NOT NULL CHECK (source_score BETWEEN 0 AND 1), selected boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS research_claims_key_idx ON research_claims (research_run_id, canonical_key);
CREATE TABLE IF NOT EXISTS research_claim_evidence (
    claim_id uuid NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
    evidence_id uuid NOT NULL REFERENCES research_evidence(id) ON DELETE CASCADE,
    PRIMARY KEY (claim_id, evidence_id)
);
CREATE TABLE IF NOT EXISTS research_claim_relations (
    id uuid PRIMARY KEY, research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    from_claim_id uuid NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
    to_claim_id uuid NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
    relation text NOT NULL CHECK (relation IN ('supports', 'contradicts', 'derives_from', 'supersedes', 'qualifies')),
    rationale text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS research_contradictions (
    id uuid PRIMARY KEY, research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    canonical_key text NOT NULL, claim_ids jsonb NOT NULL, critical boolean NOT NULL,
    status text NOT NULL CHECK (status IN ('open', 'provisional', 'resolved')),
    selected_claim_id uuid REFERENCES research_claims(id) ON DELETE SET NULL,
    rationale text NOT NULL DEFAULT '', candidate_values jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS research_sensitivity_scenarios (
    id uuid PRIMARY KEY, research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    contradiction_id uuid NOT NULL REFERENCES research_contradictions(id) ON DELETE CASCADE,
    canonical_key text NOT NULL, candidate_claim_id uuid NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
    candidate_value jsonb, selected boolean NOT NULL,
    impact_status text NOT NULL CHECK (impact_status IN ('selected_input', 'alternative_input')),
    calculation_status text NOT NULL DEFAULT 'pending' CHECK (calculation_status IN ('pending', 'calculated', 'not_applicable')),
    baseline_target_price numeric, scenario_target_price numeric, target_impact_pct numeric
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

-- 4a. Jev probabilistic direction forecasts. Runs retain request-level
-- provenance while predictions are normalized one row per forecast horizon so
-- hit-rate and calibration queries never need to scan JSON blobs.
CREATE TABLE IF NOT EXISTS report_jev_runs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id         uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    model_id          text NOT NULL,
    question_version  text NOT NULL,
    forecast_mode     text NOT NULL CHECK (forecast_mode IN ('forward', 'retrospective')),
    status            text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    input_sha256      text NOT NULL,
    input_chars       int NOT NULL CHECK (input_chars >= 0),
    input_truncated   boolean NOT NULL DEFAULT false,
    redaction_version text NOT NULL,
    usage             jsonb,
    provider_metadata jsonb,
    error             text NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    UNIQUE (report_id, model_id, question_version),
    UNIQUE (id, report_id)
);

CREATE INDEX IF NOT EXISTS report_jev_runs_report_idx
    ON report_jev_runs (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_jev_runs_mode_status_idx
    ON report_jev_runs (forecast_mode, status, completed_at DESC);

CREATE TABLE IF NOT EXISTS report_jev_predictions (
    run_id          uuid NOT NULL,
    report_id       uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    horizon         text NOT NULL CHECK (horizon IN ('1w', '1m', '3m', '6m', '1y', '3y', '5y')),
    horizon_days    int NOT NULL CHECK (horizon_days > 0),
    probability_up numeric NOT NULL CHECK (probability_up >= 0 AND probability_up <= 1),
    predicted_up    boolean NOT NULL,
    confidence      numeric NOT NULL CHECK (confidence >= 0.5 AND confidence <= 1),
    target_at       timestamptz NOT NULL,
    outcome_status  text NOT NULL DEFAULT 'pending'
                    CHECK (outcome_status IN ('pending', 'realized', 'unavailable')),
    baseline_price  numeric,
    baseline_at     date,
    outcome_price   numeric,
    outcome_at      date,
    realized_up     boolean,
    was_correct     boolean,
    brier_score     numeric CHECK (brier_score >= 0 AND brier_score <= 1),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, horizon),
    UNIQUE (report_id, horizon, run_id),
    FOREIGN KEY (run_id, report_id)
        REFERENCES report_jev_runs(id, report_id) ON DELETE CASCADE,
    CHECK (predicted_up = (probability_up >= 0.5)),
    CHECK (abs(confidence - greatest(probability_up, 1 - probability_up)) < 0.000001),
    CHECK (
        outcome_status <> 'realized'
        OR (
            baseline_price IS NOT NULL AND baseline_at IS NOT NULL
            AND outcome_price IS NOT NULL AND outcome_at IS NOT NULL
            AND realized_up IS NOT NULL AND was_correct IS NOT NULL
            AND brier_score IS NOT NULL
            AND was_correct = (predicted_up = realized_up)
        )
    )
);

CREATE INDEX IF NOT EXISTS report_jev_predictions_report_idx
    ON report_jev_predictions (report_id, horizon);
CREATE INDEX IF NOT EXISTS report_jev_predictions_maturity_idx
    ON report_jev_predictions (outcome_status, target_at)
    WHERE outcome_status = 'pending';

-- 5. Durable orchestration for administrator-triggered Nasdaq universe runs.
CREATE TABLE IF NOT EXISTS nasdaq_universe_runs (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id            uuid NOT NULL REFERENCES report_releases(id),
    requested_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
    requested_by_email    text NOT NULL,
    requested_mode        text NOT NULL CHECK (requested_mode IN ('all', 'selected', 'missing_week')),
    effective_mode        text NOT NULL CHECK (effective_mode IN ('all', 'selected', 'missing_week', 'resume_week')),
    status                text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
    universe_source       text NOT NULL,
    universe_as_of        timestamptz,
    universe_snapshot     jsonb NOT NULL,
    universe_count        int NOT NULL CHECK (universe_count >= 0),
    requested_count       int NOT NULL CHECK (requested_count >= 0),
    completed_count       int NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    failed_count          int NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    max_attempts          int NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    concurrency           smallint NOT NULL DEFAULT 4 CHECK (concurrency BETWEEN 1 AND 12),
    estimated_cost_per_attempt_usd numeric(10, 4) NOT NULL DEFAULT 2.0 CHECK (estimated_cost_per_attempt_usd > 0),
    estimated_cost_usd    numeric(12, 4) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
    observed_cost_usd     numeric(12, 4) NOT NULL DEFAULT 0 CHECK (observed_cost_usd >= 0),
    budget_limit_usd      numeric(12, 2) NOT NULL DEFAULT 600 CHECK (budget_limit_usd > 0),
    stop_requested_at     timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    started_at            timestamptz,
    finished_at           timestamptz,
    heartbeat_at          timestamptz,
    error                 text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS nasdaq_universe_one_live_run_idx
    ON nasdaq_universe_runs ((1)) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS nasdaq_universe_runs_recent_idx
    ON nasdaq_universe_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS nasdaq_universe_runs_release_idx
    ON nasdaq_universe_runs (release_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nasdaq_universe_run_items (
    run_id          uuid NOT NULL REFERENCES nasdaq_universe_runs(id) ON DELETE CASCADE,
    ticker          text NOT NULL,
    company_name    text,
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    attempts        int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    report_id       uuid REFERENCES reports(id) ON DELETE SET NULL,
    last_error      text NOT NULL DEFAULT '',
    started_at      timestamptz,
    finished_at     timestamptz,
    worker_id       text,
    lease_expires_at timestamptz,
    heartbeat_at    timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    estimated_cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
    observed_cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, ticker)
);

CREATE INDEX IF NOT EXISTS nasdaq_universe_items_status_idx
    ON nasdaq_universe_run_items (run_id, status, ticker);
CREATE INDEX IF NOT EXISTS nasdaq_universe_items_claim_idx
    ON nasdaq_universe_run_items (run_id, next_attempt_at, ticker)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS nasdaq_universe_items_lease_idx
    ON nasdaq_universe_run_items (run_id, lease_expires_at)
    WHERE status = 'running';

ALTER TABLE IF EXISTS site_runs
    ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'analysis',
    ADD COLUMN IF NOT EXISTS release_id uuid REFERENCES report_releases(id),
    ADD COLUMN IF NOT EXISTS batch_id uuid,
    ADD COLUMN IF NOT EXISTS research_run_id uuid REFERENCES research_runs(id),
    ADD COLUMN IF NOT EXISTS engine_id text NOT NULL DEFAULT 'deterministic_v1',
    ADD COLUMN IF NOT EXISTS engine_version text NOT NULL DEFAULT '1.0.0',
    ADD COLUMN IF NOT EXISTS harness_schema_version text NOT NULL DEFAULT '1.0',
    ADD COLUMN IF NOT EXISTS research_quality_status text NOT NULL DEFAULT 'green',
    ADD COLUMN IF NOT EXISTS automation_eligible boolean NOT NULL DEFAULT true;

DO $$
BEGIN
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

DO $$
BEGIN
    IF to_regclass('site_runs') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'site_runs_workspace_check'
    ) THEN
        ALTER TABLE site_runs
            ADD CONSTRAINT site_runs_workspace_check
            CHECK (workspace IN ('analysis', 'nasdaq100'));
    END IF;
    IF to_regclass('site_runs') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'site_runs_release_id_fkey'
    ) THEN
        ALTER TABLE site_runs
            ADD CONSTRAINT site_runs_release_id_fkey
            FOREIGN KEY (release_id) REFERENCES report_releases(id) ON DELETE SET NULL;
    END IF;
    IF to_regclass('site_runs') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'site_runs_batch_id_fkey'
    ) THEN
        ALTER TABLE site_runs
            ADD CONSTRAINT site_runs_batch_id_fkey
            FOREIGN KEY (batch_id) REFERENCES nasdaq_universe_runs(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Maintain tickers.report_count and last_analyzed_at via trigger.
CREATE OR REPLACE FUNCTION trg_reports_after_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE tickers
           SET report_count     = report_count + 1,
               last_analyzed_at = GREATEST(coalesce(last_analyzed_at, NEW.generated_at),
                                           NEW.generated_at)
         WHERE symbol = NEW.ticker;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE tickers
           SET report_count = GREATEST(report_count - 1, 0)
         WHERE symbol = OLD.ticker;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reports_after_change ON reports;
CREATE TRIGGER reports_after_change
    AFTER INSERT OR DELETE ON reports
    FOR EACH ROW EXECUTE FUNCTION trg_reports_after_change();
