-- Isolate the existing open Analysis workspace from staged Nasdaq-100 releases.

CREATE TABLE IF NOT EXISTS report_releases (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace     text NOT NULL CHECK (workspace IN ('analysis', 'nasdaq100')),
    release_key   text NOT NULL,
    status        text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'active')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    activated_at  timestamptz,
    UNIQUE (workspace, release_key),
    CHECK (
        (status = 'staged' AND activated_at IS NULL)
        OR (status = 'active' AND activated_at IS NOT NULL)
    )
);

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'analysis',
    ADD COLUMN IF NOT EXISTS release_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reports_workspace_check'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT reports_workspace_check
            CHECK (workspace IN ('analysis', 'nasdaq100'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reports_release_id_fkey'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT reports_release_id_fkey
            FOREIGN KEY (release_id) REFERENCES report_releases(id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reports_workspace_release_check'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT reports_workspace_release_check
            CHECK (
                (workspace = 'analysis' AND release_id IS NULL)
                OR (workspace = 'nasdaq100' AND release_id IS NOT NULL)
            );
    END IF;
END $$;

DROP INDEX IF EXISTS reports_dedup_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reports_workspace_dedup_idx
    ON reports (
        (coalesce(user_id::text, '')),
        workspace,
        (coalesce(release_id::text, '')),
        ticker,
        generated_at
    );

CREATE INDEX IF NOT EXISTS reports_workspace_recent_idx
    ON reports (workspace, generated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_release_idx
    ON reports (release_id, generated_at DESC) WHERE release_id IS NOT NULL;

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
    IF TG_OP = 'INSERT' AND release_status <> 'staged' THEN
        RAISE EXCEPTION 'cannot add reports to an active release';
    END IF;
    IF TG_OP = 'UPDATE'
       AND (NEW.workspace IS DISTINCT FROM OLD.workspace OR NEW.release_id IS DISTINCT FROM OLD.release_id)
       AND release_status <> 'staged' THEN
        RAISE EXCEPTION 'cannot move reports into an active release';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_validate_release ON reports;
CREATE TRIGGER reports_validate_release
BEFORE INSERT OR UPDATE ON reports
FOR EACH ROW EXECUTE FUNCTION validate_report_release_membership();

ALTER TABLE portfolio_snapshots
    ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'analysis',
    ADD COLUMN IF NOT EXISTS benchmark_symbol text NOT NULL DEFAULT '^SP500TR',
    ADD COLUMN IF NOT EXISTS benchmark_name text NOT NULL DEFAULT 'S&P 500 Total Return';

ALTER TABLE portfolio_nav_daily
    ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT 'analysis';

DO $$
DECLARE
    constraint_name text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_snapshots_workspace_check'
    ) THEN
        ALTER TABLE portfolio_snapshots
            ADD CONSTRAINT portfolio_snapshots_workspace_check
            CHECK (workspace IN ('analysis', 'nasdaq100'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_nav_daily_workspace_check'
    ) THEN
        ALTER TABLE portfolio_nav_daily
            ADD CONSTRAINT portfolio_nav_daily_workspace_check
            CHECK (workspace IN ('analysis', 'nasdaq100'));
    END IF;

    SELECT c.conname INTO constraint_name
      FROM pg_constraint c
     WHERE c.conrelid = 'portfolio_snapshots'::regclass
       AND c.contype = 'u'
       AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE (track, lens_type, lens_key, cutoff_at, methodology_version)%'
     LIMIT 1;
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE portfolio_snapshots DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_snapshots_workspace_unique'
    ) THEN
        ALTER TABLE portfolio_snapshots
            ADD CONSTRAINT portfolio_snapshots_workspace_unique
            UNIQUE (workspace, track, lens_type, lens_key, cutoff_at, methodology_version);
    END IF;
END $$;

ALTER TABLE portfolio_nav_daily DROP CONSTRAINT IF EXISTS portfolio_nav_daily_pkey;
ALTER TABLE portfolio_nav_daily
    ADD CONSTRAINT portfolio_nav_daily_pkey
    PRIMARY KEY (workspace, track, lens_type, lens_key, methodology_version, nav_date);

CREATE INDEX IF NOT EXISTS portfolio_snapshots_workspace_lookup_idx
    ON portfolio_snapshots (workspace, track, methodology_version, lens_type, lens_key, cutoff_at DESC);
CREATE INDEX IF NOT EXISTS portfolio_nav_daily_workspace_lookup_idx
    ON portfolio_nav_daily (workspace, track, methodology_version, lens_type, lens_key, nav_date DESC);
