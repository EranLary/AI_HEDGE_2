-- Raise the planned Nasdaq universe-run safety ceiling for newly created runs.

ALTER TABLE nasdaq_universe_runs
    ALTER COLUMN budget_limit_usd SET DEFAULT 600;
