-- Persist the current company classification once per ticker. Report payloads
-- retain their own generation-time snapshot for auditability, while ticker
-- pages read these fields without a live provider call.
ALTER TABLE tickers
    ADD COLUMN IF NOT EXISTS sector text,
    ADD COLUMN IF NOT EXISTS industry text,
    ADD COLUMN IF NOT EXISTS profile_source text,
    ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS tickers_sector_idx
    ON tickers (sector)
    WHERE sector IS NOT NULL AND btrim(sector) <> '';
