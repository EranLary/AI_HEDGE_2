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
    analysis_md_source  text  NOT NULL DEFAULT 'txt',  -- txt | html | pdf
    r2_keys             jsonb                          -- {kind: r2_object_key}; NULL until Phase 1
);

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
    budget_limit_usd      numeric(12, 2) NOT NULL DEFAULT 300 CHECK (budget_limit_usd > 0),
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
    ADD COLUMN IF NOT EXISTS batch_id uuid;

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
