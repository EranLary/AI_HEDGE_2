CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0. Users: one row per signed-in Google account.
CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    google_sub    text NOT NULL UNIQUE,
    email         text NOT NULL UNIQUE,
    name          text,
    image_url     text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now()
);

-- 1. Dimension: one row per ticker the system has touched.
CREATE TABLE IF NOT EXISTS tickers (
    symbol            text PRIMARY KEY,
    company_name      text,
    exchange          text,
    currency          text,
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    last_analyzed_at  timestamptz,
    report_count      int  NOT NULL DEFAULT 0,
    is_supported      boolean NOT NULL DEFAULT true
);

-- 2. Slim "discoverable" report row -- what list pages query.
CREATE TABLE IF NOT EXISTS reports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticker              text NOT NULL REFERENCES tickers(symbol),
    user_id             uuid REFERENCES users(id) ON DELETE SET NULL,

    generated_at        timestamptz NOT NULL,
    dashboard_version   text NOT NULL,

    -- Denormalized for cheap list queries (no JSON deref).
    company_name        text,
    current_price       numeric,
    market_cap          numeric,
    currency            text,
    recommendation      text,                          -- LONG / SHORT / HOLD / null
    mean_target_price   numeric,

    visibility          text NOT NULL DEFAULT 'public',-- public | private | unlisted
    source              text NOT NULL,                 -- fly_backfill | cli | site | bot
    source_run_id       text,
    origin_path         text,

    deleted_at          timestamptz,                   -- soft delete
    superseded_by_id    uuid REFERENCES reports(id),

    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_ticker_generated_idx
    ON reports (ticker, generated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_user_idx
    ON reports (user_id, generated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_recent_public_idx
    ON reports (generated_at DESC) WHERE deleted_at IS NULL AND visibility = 'public';

-- Dedup per (user, ticker, generated_at). NULL user_id is a single bucket
-- so two backfill rows for the same (ticker, generated_at) collide.
CREATE UNIQUE INDEX IF NOT EXISTS reports_dedup_idx
    ON reports ((coalesce(user_id::text, '')), ticker, generated_at);

-- 3. Heavy content -- fetched only when a user opens a report.
CREATE TABLE IF NOT EXISTS report_artifacts (
    report_id           uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
    dashboard           jsonb NOT NULL,
    analysis_md         text  NOT NULL,
    prices_explain_md   text,
    analysis_md_source  text  NOT NULL DEFAULT 'txt'   -- txt | html | pdf
);

-- Maintain tickers.report_count and last_analyzed_at via trigger.
CREATE OR REPLACE FUNCTION trg_reports_after_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE tickers
           SET report_count     = report_count + 1,
               last_analyzed_at = GREATEST(coalesce(last_analyzed_at, NEW.generated_at),
                                           NEW.generated_at)
         WHERE symbol = NEW.ticker;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE tickers
           SET report_count = GREATEST(report_count - 1, 0)
         WHERE symbol = OLD.ticker;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reports_after_change ON reports;
CREATE TRIGGER reports_after_change
    AFTER INSERT OR DELETE ON reports
    FOR EACH ROW EXECUTE FUNCTION trg_reports_after_change();
