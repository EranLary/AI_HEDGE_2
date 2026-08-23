-- Preserve technical attempt errors and distinguish stopped work from failures.

ALTER TABLE nasdaq_universe_runs
    DROP CONSTRAINT IF EXISTS nasdaq_universe_runs_status_check;

ALTER TABLE nasdaq_universe_runs
    ADD CONSTRAINT nasdaq_universe_runs_status_check
        CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'stopped')),
    ADD COLUMN IF NOT EXISTS stopped_count int NOT NULL DEFAULT 0
        CHECK (stopped_count >= 0);

ALTER TABLE nasdaq_universe_run_items
    DROP CONSTRAINT IF EXISTS nasdaq_universe_run_items_status_check;

ALTER TABLE nasdaq_universe_run_items
    ADD CONSTRAINT nasdaq_universe_run_items_status_check
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'stopped')),
    ADD COLUMN IF NOT EXISTS final_status_reason text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS nasdaq_universe_run_attempts (
    run_id       uuid NOT NULL,
    ticker       text NOT NULL,
    attempt      int NOT NULL CHECK (attempt > 0),
    worker_id    text NOT NULL,
    job_id       text NOT NULL,
    status       text NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'completed', 'failed', 'stopped')),
    error        text NOT NULL DEFAULT '',
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    PRIMARY KEY (run_id, ticker, attempt),
    FOREIGN KEY (run_id, ticker)
        REFERENCES nasdaq_universe_run_items(run_id, ticker) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS nasdaq_universe_run_attempts_recent_idx
    ON nasdaq_universe_run_attempts (run_id, started_at DESC);
