-- Make Paper execution correction-aware, single-writer, and cash-isolated.

ALTER TABLE trading_connections
    ADD COLUMN IF NOT EXISTS executor_lease_owner text,
    ADD COLUMN IF NOT EXISTS executor_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS trading_connections_executor_lease_idx
    ON trading_connections (executor_lease_expires_at)
    WHERE executor_lease_owner IS NOT NULL;

ALTER TABLE trading_strategy_links
    ADD COLUMN IF NOT EXISTS cash_seed_usd numeric(18, 2);

UPDATE trading_strategy_links
   SET cash_seed_usd = budget_usd
 WHERE cash_seed_usd IS NULL;

ALTER TABLE trading_strategy_links
    ALTER COLUMN cash_seed_usd SET NOT NULL;

ALTER TABLE trading_fills
    ADD COLUMN IF NOT EXISTS exec_family_id text,
    ADD COLUMN IF NOT EXISTS exec_revision integer;

UPDATE trading_fills
   SET exec_family_id = CASE
         WHEN exec_id ~ '[.][0-9]+$' THEN regexp_replace(exec_id, '[.][0-9]+$', '')
         ELSE exec_id
       END,
       exec_revision = CASE
         WHEN exec_id ~ '[.][0-9]+$' THEN (substring(exec_id FROM '[.]([0-9]+)$'))::integer
         ELSE 0
       END
 WHERE exec_family_id IS NULL OR exec_revision IS NULL;

ALTER TABLE trading_fills
    ALTER COLUMN exec_family_id SET NOT NULL,
    ALTER COLUMN exec_revision SET NOT NULL;

CREATE INDEX IF NOT EXISTS trading_fills_execution_revision_idx
    ON trading_fills (connection_id, exec_family_id, exec_revision);

COMMENT ON COLUMN trading_fills.exec_family_id IS
    'IBKR correction family. A corrected execution changes only the suffix after the final period.';
COMMENT ON COLUMN trading_strategy_links.cash_seed_usd IS
    'Explicit user allocation. Effective strategy cash is seed plus correction-aware net fills.';
