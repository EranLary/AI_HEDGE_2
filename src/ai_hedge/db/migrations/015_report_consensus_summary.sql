-- Persist the small consensus fields used by lists and ranking pages so new
-- reports do not need JSON projection at read time. Historical reports that
-- predate the explicit Mean/Median contract remain NULL and are normalized by
-- the application from a compact dashboard projection.
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS median_target_price numeric,
    ADD COLUMN IF NOT EXISTS consensus_target_price numeric,
    ADD COLUMN IF NOT EXISTS consensus_allocation_pct numeric,
    ADD COLUMN IF NOT EXISTS consensus_score numeric,
    ADD COLUMN IF NOT EXISTS consensus_basis text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reports_consensus_basis_check'
    ) THEN
        ALTER TABLE reports
            ADD CONSTRAINT reports_consensus_basis_check
            CHECK (consensus_basis IN ('mean_median', 'mean_only'));
    END IF;
END $$;

-- Backfill only reports that already carry the explicit consensus contract.
-- Older reports intentionally stay NULL so TypeScript can reconstruct a real
-- Median from their independent valuation-family values.
UPDATE reports AS r
   SET median_target_price = CASE
           WHEN jsonb_typeof(a.dashboard #> '{valuation_hub,consensus,median_target_price}') = 'number'
             THEN (a.dashboard #>> '{valuation_hub,consensus,median_target_price}')::numeric
           ELSE NULL
       END,
       consensus_target_price = CASE
           WHEN jsonb_typeof(a.dashboard #> '{valuation_hub,consensus,decision_target_price}') = 'number'
             THEN (a.dashboard #>> '{valuation_hub,consensus,decision_target_price}')::numeric
           ELSE NULL
       END,
       consensus_allocation_pct = CASE
           WHEN jsonb_typeof(a.dashboard #> '{score_card,position_size_pct_of_notional}') = 'number'
             THEN (a.dashboard #>> '{score_card,position_size_pct_of_notional}')::numeric
           WHEN jsonb_typeof(a.dashboard #> '{decision_card,position_size_pct_of_notional}') = 'number'
             THEN (a.dashboard #>> '{decision_card,position_size_pct_of_notional}')::numeric
           ELSE NULL
       END,
       consensus_score = CASE
           WHEN jsonb_typeof(a.dashboard #> '{score_card,adjusted_score}') = 'number'
             THEN (a.dashboard #>> '{score_card,adjusted_score}')::numeric
           WHEN jsonb_typeof(a.dashboard #> '{decision_card,adjusted_score}') = 'number'
             THEN (a.dashboard #>> '{decision_card,adjusted_score}')::numeric
           ELSE NULL
       END,
       consensus_basis = CASE
           WHEN a.dashboard #>> '{valuation_hub,consensus,consensus_basis}' IN ('mean_median', 'mean_only')
             THEN a.dashboard #>> '{valuation_hub,consensus,consensus_basis}'
           WHEN a.dashboard #>> '{score_card,consensus_basis}' IN ('mean_median', 'mean_only')
             THEN a.dashboard #>> '{score_card,consensus_basis}'
           ELSE NULL
       END
  FROM report_artifacts AS a
 WHERE a.report_id = r.id
   AND (
       a.dashboard #>> '{valuation_hub,consensus,consensus_basis}' IN ('mean_median', 'mean_only')
       OR a.dashboard #>> '{score_card,consensus_basis}' IN ('mean_median', 'mean_only')
   );
