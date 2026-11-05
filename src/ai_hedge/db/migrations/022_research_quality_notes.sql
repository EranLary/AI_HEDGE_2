ALTER TABLE research_runs
    ADD COLUMN IF NOT EXISTS quality_notes jsonb NOT NULL DEFAULT '[]'::jsonb;
