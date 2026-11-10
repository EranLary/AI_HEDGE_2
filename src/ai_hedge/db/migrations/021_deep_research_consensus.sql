-- Deep Research is an independent fourth consensus component for new reports.
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
            'sector_weighted_only',
            'weighted_components_v2'
        )
    );

ALTER TABLE report_artifacts
    ADD COLUMN IF NOT EXISTS deep_research_analysis_md text,
    ADD COLUMN IF NOT EXISTS deep_research_valuation_md text;

