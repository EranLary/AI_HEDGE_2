-- Resilient, resumable Nasdaq-100 universe runs with incremental publication.

ALTER TABLE report_releases
    DROP CONSTRAINT IF EXISTS report_releases_status_check,
    DROP CONSTRAINT IF EXISTS report_releases_check,
    DROP CONSTRAINT IF EXISTS report_releases_activation_check;

ALTER TABLE report_releases
    ADD COLUMN IF NOT EXISTS coverage_complete boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT report_releases_status_check
        CHECK (status IN ('staged', 'running', 'active')),
    ADD CONSTRAINT report_releases_activation_check
        CHECK (
            (status = 'staged' AND activated_at IS NULL)
            OR (status IN ('running', 'active') AND activated_at IS NOT NULL)
        );

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS available_at timestamptz;

UPDATE reports r
   SET available_at = CASE
       WHEN r.workspace = 'nasdaq100' THEN coalesce(rr.activated_at, r.created_at)
       ELSE r.created_at
   END
  FROM report_releases rr
 WHERE r.release_id = rr.id
   AND r.available_at IS NULL;

UPDATE reports
   SET available_at = created_at
 WHERE available_at IS NULL;

ALTER TABLE reports
    ALTER COLUMN available_at SET DEFAULT now(),
    ALTER COLUMN available_at SET NOT NULL;

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

    SELECT workspace, status
      INTO release_workspace, release_status
      FROM report_releases
     WHERE id = NEW.release_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'nasdaq100 report release does not exist';
    END IF;
    IF release_workspace <> NEW.workspace THEN
        RAISE EXCEPTION 'report workspace does not match release workspace';
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

ALTER TABLE site_runs
    ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'analysis',
    ADD COLUMN IF NOT EXISTS release_id uuid REFERENCES report_releases(id),
    ADD COLUMN IF NOT EXISTS batch_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'site_runs_workspace_check'
    ) THEN
        ALTER TABLE site_runs
            ADD CONSTRAINT site_runs_workspace_check
            CHECK (workspace IN ('analysis', 'nasdaq100'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'site_runs_release_id_fkey'
    ) THEN
        ALTER TABLE site_runs
            ADD CONSTRAINT site_runs_release_id_fkey
            FOREIGN KEY (release_id) REFERENCES report_releases(id) ON DELETE SET NULL;
    END IF;
END $$;

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
    created_at            timestamptz NOT NULL DEFAULT now(),
    started_at            timestamptz,
    finished_at           timestamptz,
    heartbeat_at          timestamptz,
    error                 text NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS nasdaq_universe_one_live_run_idx
    ON nasdaq_universe_runs ((1))
    WHERE status IN ('queued', 'running');
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
    PRIMARY KEY (run_id, ticker)
);

CREATE INDEX IF NOT EXISTS nasdaq_universe_items_status_idx
    ON nasdaq_universe_run_items (run_id, status, ticker);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'site_runs_batch_id_fkey'
    ) THEN
        ALTER TABLE site_runs
            ADD CONSTRAINT site_runs_batch_id_fkey
            FOREIGN KEY (batch_id) REFERENCES nasdaq_universe_runs(id) ON DELETE SET NULL;
    END IF;
END $$;
