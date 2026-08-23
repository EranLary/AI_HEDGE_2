-- Personal IBKR paper-trading control plane. Broker credentials stay on the
-- executor VM; this database contains only scoped device-token hashes,
-- strategy configuration, commands, and an immutable execution audit trail.

CREATE TABLE IF NOT EXISTS portfolio_refresh_runs (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace             text NOT NULL CHECK (workspace IN ('analysis', 'nasdaq100')),
    track                 text NOT NULL CHECK (track IN ('backtest', 'paper')),
    methodology_version   text NOT NULL,
    status                text NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'completed', 'partial', 'failed')),
    provider_warnings     jsonb NOT NULL DEFAULT '[]'::jsonb,
    error                 text NOT NULL DEFAULT '',
    started_at            timestamptz NOT NULL DEFAULT now(),
    finished_at           timestamptz
);

CREATE INDEX IF NOT EXISTS portfolio_refresh_runs_recent_idx
    ON portfolio_refresh_runs (workspace, track, started_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_snapshot_trade_eligibility (
    snapshot_id           uuid PRIMARY KEY REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    refresh_run_id        uuid NOT NULL REFERENCES portfolio_refresh_runs(id) ON DELETE RESTRICT,
    eligible              boolean NOT NULL DEFAULT false,
    reasons               jsonb NOT NULL DEFAULT '[]'::jsonb,
    checked_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_snapshot_trade_eligibility_run_idx
    ON portfolio_snapshot_trade_eligibility (refresh_run_id, eligible);

CREATE TABLE IF NOT EXISTS trading_connections (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    broker                text NOT NULL DEFAULT 'ibkr' CHECK (broker = 'ibkr'),
    mode                  text NOT NULL CHECK (mode IN ('paper', 'live')),
    account_fingerprint   text,
    account_masked        text NOT NULL DEFAULT '',
    device_secret_hash    text,
    status                text NOT NULL DEFAULT 'awaiting_pairing'
                          CHECK (status IN ('awaiting_pairing', 'disconnected', 'ready', 'paused', 'error', 'revoked')),
    gateway_connected     boolean NOT NULL DEFAULT false,
    gateway_authenticated boolean NOT NULL DEFAULT false,
    executor_version      text NOT NULL DEFAULT '',
    last_heartbeat_at     timestamptz,
    last_error            text NOT NULL DEFAULT '',
    paired_at             timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trading_connections_account_idx
    ON trading_connections (user_id, mode, account_fingerprint)
    WHERE account_fingerprint IS NOT NULL AND status <> 'revoked';
CREATE INDEX IF NOT EXISTS trading_connections_user_idx
    ON trading_connections (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trading_pairing_codes (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id         uuid NOT NULL REFERENCES trading_connections(id) ON DELETE CASCADE,
    code_hash             text NOT NULL UNIQUE,
    expires_at            timestamptz NOT NULL,
    consumed_at           timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trading_pairing_codes_active_idx
    ON trading_pairing_codes (expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS trading_strategy_previews (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id         uuid NOT NULL REFERENCES trading_connections(id) ON DELETE CASCADE,
    workspace             text NOT NULL CHECK (workspace IN ('analysis', 'nasdaq100')),
    lens_type             text NOT NULL CHECK (lens_type IN ('overall', 'model', 'valuator')),
    lens_key              text NOT NULL,
    methodology_version   text NOT NULL,
    budget_usd            numeric(18, 2) NOT NULL CHECK (budget_usd > 0),
    arm                   boolean NOT NULL DEFAULT false,
    snapshot_id           uuid NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    preview_payload       jsonb NOT NULL,
    expires_at            timestamptz NOT NULL,
    consumed_at           timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trading_strategy_previews_active_idx
    ON trading_strategy_previews (user_id, expires_at DESC)
    WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS trading_strategy_links (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id         uuid NOT NULL UNIQUE REFERENCES trading_connections(id) ON DELETE CASCADE,
    workspace             text NOT NULL CHECK (workspace IN ('analysis', 'nasdaq100')),
    lens_type             text NOT NULL CHECK (lens_type IN ('overall', 'model', 'valuator')),
    lens_key              text NOT NULL,
    methodology_version   text NOT NULL,
    budget_usd            numeric(18, 2) NOT NULL CHECK (budget_usd > 0),
    reserve_fraction      numeric(8, 6) NOT NULL DEFAULT 0.02
                          CHECK (reserve_fraction >= 0 AND reserve_fraction < 1),
    status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'armed', 'paused', 'blocked', 'revoked')),
    latest_snapshot_id    uuid REFERENCES portfolio_snapshots(id) ON DELETE SET NULL,
    last_error            text NOT NULL DEFAULT '',
    armed_at              timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trading_strategy_links_lookup_idx
    ON trading_strategy_links (workspace, lens_type, lens_key, methodology_version, status);

CREATE TABLE IF NOT EXISTS trading_instruments (
    symbol                text PRIMARY KEY,
    conid                 bigint NOT NULL UNIQUE,
    sec_type              text NOT NULL DEFAULT 'STK',
    exchange              text NOT NULL,
    primary_exchange      text NOT NULL,
    currency              text NOT NULL,
    min_tick              numeric,
    min_size              numeric,
    size_increment        numeric,
    supports_fractional   boolean NOT NULL DEFAULT false,
    liquid_hours          text NOT NULL DEFAULT '',
    time_zone             text NOT NULL DEFAULT '',
    approved              boolean NOT NULL DEFAULT false,
    approved_at           timestamptz,
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_rebalance_plans (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_link_id      uuid NOT NULL REFERENCES trading_strategy_links(id) ON DELETE CASCADE,
    snapshot_id           uuid NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE RESTRICT,
    status                text NOT NULL DEFAULT 'queued'
                          CHECK (status IN (
                              'queued', 'preflight', 'awaiting_market', 'selling', 'buying',
                              'completed', 'partial', 'blocked', 'cancel_requested', 'cancelled'
                          )),
    target_holdings       jsonb NOT NULL,
    preflight             jsonb NOT NULL DEFAULT '{}'::jsonb,
    command_revision      int NOT NULL DEFAULT 1 CHECK (command_revision > 0),
    not_before            timestamptz,
    claimed_at            timestamptz,
    completed_at          timestamptz,
    error                 text NOT NULL DEFAULT '',
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (strategy_link_id, snapshot_id)
);

CREATE INDEX IF NOT EXISTS trading_rebalance_plans_claim_idx
    ON trading_rebalance_plans (status, not_before, created_at)
    WHERE status IN ('queued', 'preflight', 'awaiting_market', 'partial', 'cancel_requested');

CREATE TABLE IF NOT EXISTS trading_orders (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rebalance_plan_id     uuid NOT NULL REFERENCES trading_rebalance_plans(id) ON DELETE CASCADE,
    client_order_key      text NOT NULL UNIQUE,
    symbol                text NOT NULL,
    conid                 bigint,
    side                  text NOT NULL CHECK (side IN ('BUY', 'SELL')),
    requested_quantity    numeric NOT NULL CHECK (requested_quantity > 0),
    limit_price           numeric,
    ib_order_id           bigint,
    ib_perm_id            bigint,
    status                text NOT NULL DEFAULT 'planned'
                          CHECK (status IN ('planned', 'what_if', 'submitted', 'partially_filled', 'filled', 'cancel_pending', 'cancelled', 'rejected', 'error')),
    filled_quantity       numeric NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
    average_fill_price    numeric,
    commission            numeric NOT NULL DEFAULT 0,
    commission_currency   text NOT NULL DEFAULT 'USD',
    raw_status            jsonb NOT NULL DEFAULT '{}'::jsonb,
    submitted_at          timestamptz,
    completed_at          timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trading_orders_perm_id_idx
    ON trading_orders (ib_perm_id) WHERE ib_perm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trading_orders_plan_idx
    ON trading_orders (rebalance_plan_id, created_at);

CREATE TABLE IF NOT EXISTS trading_fills (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id              uuid REFERENCES trading_orders(id) ON DELETE SET NULL,
    connection_id         uuid NOT NULL REFERENCES trading_connections(id) ON DELETE CASCADE,
    exec_id               text NOT NULL UNIQUE,
    symbol                text NOT NULL,
    side                  text NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity              numeric NOT NULL CHECK (quantity > 0),
    price                 numeric NOT NULL CHECK (price > 0),
    commission            numeric NOT NULL DEFAULT 0,
    commission_currency   text NOT NULL DEFAULT 'USD',
    executed_at           timestamptz NOT NULL,
    raw_execution         jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trading_fills_connection_idx
    ON trading_fills (connection_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS trading_strategy_positions (
    strategy_link_id      uuid NOT NULL REFERENCES trading_strategy_links(id) ON DELETE CASCADE,
    symbol                text NOT NULL,
    conid                 bigint,
    quantity              numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    average_cost_usd      numeric,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (strategy_link_id, symbol)
);

CREATE TABLE IF NOT EXISTS trading_request_nonces (
    connection_id         uuid NOT NULL REFERENCES trading_connections(id) ON DELETE CASCADE,
    nonce                 text NOT NULL,
    seen_at               timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (connection_id, nonce)
);

CREATE INDEX IF NOT EXISTS trading_request_nonces_recent_idx
    ON trading_request_nonces (seen_at DESC);

CREATE TABLE IF NOT EXISTS trading_events (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id         uuid NOT NULL REFERENCES trading_connections(id) ON DELETE CASCADE,
    event_id              text NOT NULL,
    event_type            text NOT NULL,
    severity              text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    message               text NOT NULL DEFAULT '',
    payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
    telegram_sent_at      timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (connection_id, event_id)
);

CREATE INDEX IF NOT EXISTS trading_events_recent_idx
    ON trading_events (connection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trading_audit_log (
    id                    bigserial PRIMARY KEY,
    user_id               uuid REFERENCES users(id) ON DELETE SET NULL,
    connection_id         uuid REFERENCES trading_connections(id) ON DELETE SET NULL,
    actor_type            text NOT NULL CHECK (actor_type IN ('user', 'executor', 'monitor', 'system')),
    action                text NOT NULL,
    payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trading_audit_log_recent_idx
    ON trading_audit_log (connection_id, created_at DESC);
