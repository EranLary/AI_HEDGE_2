-- Phase 0.2: durable status sink for site-triggered runs.
-- Today the canonical run state lives in `outputs/_site_runs/<job_id>/_status.json`
-- on the Fly volume. Phase 3 splits Node and Python into separate apps; the FS
-- sink stops being viable. This row is the durable replacement; the FS sink
-- still runs in parallel until Phase 2 drops the Node-side reads.

CREATE TABLE IF NOT EXISTS site_runs (
    job_id              text PRIMARY KEY,
    ticker              text NOT NULL,
    user_id             uuid NULL REFERENCES users(id) ON DELETE SET NULL,
    status              text NOT NULL,           -- queued|running|completed|failed|cancelled
    created_at          timestamptz NOT NULL DEFAULT now(),
    started_at          timestamptz NULL,
    finished_at         timestamptz NULL,
    llm_total_estimated int  NOT NULL DEFAULT 30,
    llm_completed       int  NOT NULL DEFAULT 0,
    error               text NOT NULL DEFAULT '',
    report_id           uuid NULL REFERENCES reports(id) ON DELETE SET NULL,
    attempt             int  NOT NULL DEFAULT 1,
    worker_machine_id   text NULL,                -- Fly Machine id; null until Phase 3.2
    heartbeat_at        timestamptz NULL,         -- Phase 3.3 starts populating
    boot_anchor_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_runs_status_idx ON site_runs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS site_runs_user_idx  ON site_runs (user_id, created_at DESC);
