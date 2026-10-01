-- Sector-weighted-v1 adds a third consensus component while retaining legacy
-- values for dashboards that have not yet been backfilled.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_consensus_basis_check;

ALTER TABLE reports
    ADD CONSTRAINT reports_consensus_basis_check
    CHECK (
        consensus_basis IN (
            'mean_median',
            'mean_only',
            'mean_median_sector_weighted',
            'mean_sector_weighted',
            'median_sector_weighted',
            'sector_weighted_only'
        )
    );
