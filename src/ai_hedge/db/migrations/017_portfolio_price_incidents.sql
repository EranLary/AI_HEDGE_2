-- Track actionable portfolio price gaps without rewriting immutable Paper history.

CREATE TABLE IF NOT EXISTS portfolio_price_incidents (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace                text NOT NULL CHECK (workspace IN ('analysis', 'nasdaq100')),
    symbol                   text NOT NULL,
    currency                 text NOT NULL,
    status                   text NOT NULL DEFAULT 'monitoring'
                             CHECK (status IN ('monitoring', 'quarantined', 'resolved', 'ignored')),
    first_missing_on         date NOT NULL,
    last_missing_on          date NOT NULL,
    last_observed_on         date NOT NULL,
    last_observation_missing boolean NOT NULL DEFAULT true,
    missing_streak           int NOT NULL DEFAULT 1 CHECK (missing_streak >= 0),
    recovery_streak          int NOT NULL DEFAULT 0 CHECK (recovery_streak >= 0),
    affected_tracks          text[] NOT NULL DEFAULT '{}',
    affected_methodologies   text[] NOT NULL DEFAULT '{}',
    quarantined_on           date,
    quarantined_at           timestamptz,
    resolved_at              timestamptz,
    resolution_kind          text,
    resolution_effective_on  date,
    resolution_note          text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace, symbol)
);

CREATE INDEX IF NOT EXISTS portfolio_price_incidents_status_idx
    ON portfolio_price_incidents (workspace, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS portfolio_price_incident_events (
    id             bigserial PRIMARY KEY,
    incident_id    uuid NOT NULL REFERENCES portfolio_price_incidents(id) ON DELETE CASCADE,
    event_type     text NOT NULL,
    effective_on   date NOT NULL,
    actor          text NOT NULL DEFAULT 'system',
    details        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolio_price_incident_events_lookup_idx
    ON portfolio_price_incident_events (incident_id, effective_on, id);

COMMENT ON TABLE portfolio_price_incidents IS
    'Operational price-gap state. Paper snapshots and holdings remain immutable; repairs replay derived NAV only.';
COMMENT ON TABLE portfolio_price_incident_events IS
    'Append-only audit trail for automatic observations and administrator resolutions.';
