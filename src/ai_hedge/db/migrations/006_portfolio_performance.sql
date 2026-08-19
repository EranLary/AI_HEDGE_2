-- Point-in-time Top-20 model/persona portfolios and their USD total-return NAV.

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    track                 text NOT NULL CHECK (track IN ('backtest', 'paper')),
    lens_type             text NOT NULL CHECK (lens_type IN ('overall', 'model', 'valuator')),
    lens_key              text NOT NULL,
    lens_label            text NOT NULL,
    cutoff_at             timestamptz NOT NULL,
    execution_date        date,
    methodology_version   text NOT NULL,
    universe_name         text NOT NULL DEFAULT 'analyzed_reports_90d',
    provider              text NOT NULL DEFAULT 'yfinance',
    candidate_count       int NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
    selected_count        int NOT NULL DEFAULT 0 CHECK (selected_count BETWEEN 0 AND 20),
    cash_weight           numeric NOT NULL DEFAULT 0 CHECK (cash_weight BETWEEN 0 AND 1),
    status                text NOT NULL DEFAULT 'building'
                          CHECK (status IN ('building', 'ready', 'no_positions', 'stale_market_data')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (track, lens_type, lens_key, cutoff_at, methodology_version)
);

CREATE INDEX IF NOT EXISTS portfolio_snapshots_lookup_idx
    ON portfolio_snapshots (track, methodology_version, lens_type, lens_key, cutoff_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
    snapshot_id          uuid NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    rank                 int NOT NULL CHECK (rank BETWEEN 1 AND 20),
    ticker               text NOT NULL REFERENCES tickers(symbol),
    score                numeric NOT NULL,
    weight               numeric NOT NULL CHECK (weight > 0 AND weight <= 1),
    currency             text NOT NULL,
    source_report_ids    uuid[] NOT NULL DEFAULT '{}',
    entry_date           date,
    entry_price_usd      numeric,
    created_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (snapshot_id, rank),
    UNIQUE (snapshot_id, ticker)
);

CREATE INDEX IF NOT EXISTS portfolio_holdings_ticker_idx
    ON portfolio_holdings (ticker, snapshot_id);

CREATE OR REPLACE FUNCTION prevent_paper_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.track = 'paper' THEN
        RAISE EXCEPTION 'paper portfolio snapshots are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portfolio_snapshots_paper_immutable ON portfolio_snapshots;
CREATE TRIGGER portfolio_snapshots_paper_immutable
BEFORE UPDATE OR DELETE ON portfolio_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_paper_snapshot_mutation();

CREATE OR REPLACE FUNCTION prevent_paper_holding_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    snapshot_track text;
BEGIN
    SELECT track INTO snapshot_track
      FROM portfolio_snapshots
     WHERE id = OLD.snapshot_id;
    IF snapshot_track = 'paper' THEN
        RAISE EXCEPTION 'paper portfolio holdings are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portfolio_holdings_paper_immutable ON portfolio_holdings;
CREATE TRIGGER portfolio_holdings_paper_immutable
BEFORE UPDATE OR DELETE ON portfolio_holdings
FOR EACH ROW EXECUTE FUNCTION prevent_paper_holding_mutation();

CREATE TABLE IF NOT EXISTS market_prices_daily (
    symbol                  text NOT NULL,
    price_date              date NOT NULL,
    adjusted_close_local    numeric NOT NULL CHECK (adjusted_close_local > 0),
    currency                text NOT NULL,
    fx_to_usd               numeric NOT NULL CHECK (fx_to_usd > 0),
    adjusted_close_usd      numeric NOT NULL CHECK (adjusted_close_usd > 0),
    source                  text NOT NULL,
    fetched_at              timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, price_date, source)
);

CREATE INDEX IF NOT EXISTS market_prices_daily_date_idx
    ON market_prices_daily (price_date DESC, symbol);

CREATE TABLE IF NOT EXISTS portfolio_nav_daily (
    track                   text NOT NULL CHECK (track IN ('backtest', 'paper')),
    lens_type               text NOT NULL CHECK (lens_type IN ('overall', 'model', 'valuator')),
    lens_key                text NOT NULL,
    methodology_version     text NOT NULL,
    nav_date                date NOT NULL,
    snapshot_id             uuid REFERENCES portfolio_snapshots(id) ON DELETE SET NULL,
    nav                     numeric NOT NULL CHECK (nav >= 0),
    benchmark_nav           numeric NOT NULL CHECK (benchmark_nav >= 0),
    holdings_count          int NOT NULL DEFAULT 0 CHECK (holdings_count BETWEEN 0 AND 20),
    status                  text NOT NULL
                            CHECK (status IN ('ok', 'no_positions', 'stale_market_data')),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (track, lens_type, lens_key, methodology_version, nav_date)
);

CREATE INDEX IF NOT EXISTS portfolio_nav_daily_lookup_idx
    ON portfolio_nav_daily (track, methodology_version, lens_type, lens_key, nav_date DESC);

CREATE TABLE IF NOT EXISTS portfolio_refresh_locks (
    lock_key       text PRIMARY KEY,
    owner          text NOT NULL,
    acquired_at    timestamptz NOT NULL DEFAULT now()
);
