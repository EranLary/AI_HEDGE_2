-- Durable, bounded worker-pool execution for Nasdaq-100 universe runs.

ALTER TABLE nasdaq_universe_runs
    ADD COLUMN IF NOT EXISTS concurrency smallint NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS estimated_cost_per_attempt_usd numeric(10, 4) NOT NULL DEFAULT 2.0,
    ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS observed_cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS budget_limit_usd numeric(12, 2) NOT NULL DEFAULT 300,
    ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'nasdaq_universe_runs_concurrency_check'
    ) THEN
        ALTER TABLE nasdaq_universe_runs
            ADD CONSTRAINT nasdaq_universe_runs_concurrency_check
            CHECK (concurrency BETWEEN 1 AND 12);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'nasdaq_universe_runs_cost_check'
    ) THEN
        ALTER TABLE nasdaq_universe_runs
            ADD CONSTRAINT nasdaq_universe_runs_cost_check
            CHECK (
                estimated_cost_per_attempt_usd > 0
                AND estimated_cost_usd >= 0
                AND observed_cost_usd >= 0
                AND budget_limit_usd > 0
            );
    END IF;
END $$;

ALTER TABLE nasdaq_universe_run_items
    ADD COLUMN IF NOT EXISTS worker_id text,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
    ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12, 4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS observed_cost_usd numeric(12, 4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS nasdaq_universe_items_claim_idx
    ON nasdaq_universe_run_items (run_id, next_attempt_at, ticker)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS nasdaq_universe_items_lease_idx
    ON nasdaq_universe_run_items (run_id, lease_expires_at)
    WHERE status = 'running';
