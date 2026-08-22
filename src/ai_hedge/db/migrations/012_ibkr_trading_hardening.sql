-- Harden IBKR execution recovery, settled-cash sequencing, and UI preflight reporting.

ALTER TABLE trading_connections
    ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE trading_rebalance_plans
    DROP CONSTRAINT IF EXISTS trading_rebalance_plans_status_check;

ALTER TABLE trading_rebalance_plans
    ADD CONSTRAINT trading_rebalance_plans_status_check CHECK (status IN (
        'queued', 'preflight', 'awaiting_market', 'awaiting_settlement', 'selling', 'buying',
        'completed', 'partial', 'blocked', 'cancel_requested', 'cancelled'
    ));

DROP INDEX IF EXISTS trading_rebalance_plans_claim_idx;
CREATE INDEX trading_rebalance_plans_claim_idx
    ON trading_rebalance_plans (status, not_before, created_at)
    WHERE status IN (
        'queued', 'preflight', 'awaiting_market', 'awaiting_settlement', 'partial', 'cancel_requested'
    );

ALTER TABLE trading_fills
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
