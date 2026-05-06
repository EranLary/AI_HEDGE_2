-- Internal observability for LLM calls inside the agentic pipeline.
-- One obs_runs row per ticker run; one obs_calls row per LLM call.

CREATE TABLE IF NOT EXISTS obs_runs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker            text NOT NULL,
    user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
    source            text NOT NULL DEFAULT 'cli',           -- cli | site | bot
    source_run_id     text,                                  -- matches reports.source_run_id when caller passes it
    status            text NOT NULL DEFAULT 'running',       -- running | success | error
    error_message     text,
    started_at        timestamptz NOT NULL DEFAULT now(),
    ended_at          timestamptz,
    duration_ms       int,
    total_calls       int NOT NULL DEFAULT 0,
    total_tokens_in   int NOT NULL DEFAULT 0,
    total_tokens_out  int NOT NULL DEFAULT 0,
    total_cost_usd    numeric(12, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS obs_runs_started_idx
    ON obs_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS obs_runs_ticker_started_idx
    ON obs_runs (ticker, started_at DESC);
CREATE INDEX IF NOT EXISTS obs_runs_source_run_id_idx
    ON obs_runs (source_run_id) WHERE source_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS obs_calls (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id            uuid NOT NULL REFERENCES obs_runs(id) ON DELETE CASCADE,
    parent_id         uuid REFERENCES obs_calls(id) ON DELETE SET NULL,
    sequence          int NOT NULL,                          -- monotonic insertion order within run
    stage             text NOT NULL,                         -- e.g. persona.buffett | valuation.dcf | sec.qa | technical | dashboard
    persona           text,                                  -- buffett | munger | ... | NULL when not a persona call
    call_site         text,                                  -- file.qualname:lineno fallback when no explicit stage
    model_requested   text NOT NULL,                         -- deepseek-chat | deepseek-reasoner
    model_actual      text,                                  -- deepseek-v4-flash | deepseek-v4-pro
    temperature       numeric(4, 2) NOT NULL,
    prompt            text NOT NULL,                         -- the user message we sent
    prompt_sha256     bytea NOT NULL,                        -- prompt-version dedup
    response          text,                                  -- assistant content
    reasoning         text,                                  -- reasoning_content (deepseek-reasoner only)
    tokens_in         int,
    tokens_out        int,
    tokens_total      int,
    cost_usd          numeric(12, 6),
    latency_ms        int NOT NULL,
    retries           int NOT NULL DEFAULT 0,
    status            text NOT NULL,                         -- ok | error
    error_class       text,
    error_message     text,
    started_at        timestamptz NOT NULL,
    ended_at          timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS obs_calls_run_seq_idx
    ON obs_calls (run_id, sequence);
CREATE INDEX IF NOT EXISTS obs_calls_stage_idx
    ON obs_calls (stage, started_at DESC);
CREATE INDEX IF NOT EXISTS obs_calls_persona_idx
    ON obs_calls (persona, started_at DESC) WHERE persona IS NOT NULL;
CREATE INDEX IF NOT EXISTS obs_calls_prompt_sha_idx
    ON obs_calls (prompt_sha256);
CREATE INDEX IF NOT EXISTS obs_calls_parent_idx
    ON obs_calls (parent_id) WHERE parent_id IS NOT NULL;
