-- Persist Jev request provenance separately from normalized horizon predictions.
-- Historical backfills are labeled retrospective so their potentially
-- hindsight-contaminated scores never mix silently with forward forecasts.
CREATE TABLE IF NOT EXISTS report_jev_runs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id         uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    model_id          text NOT NULL,
    question_version  text NOT NULL,
    forecast_mode     text NOT NULL CHECK (forecast_mode IN ('forward', 'retrospective')),
    status            text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    input_sha256      text NOT NULL,
    input_chars       int NOT NULL CHECK (input_chars >= 0),
    input_truncated   boolean NOT NULL DEFAULT false,
    redaction_version text NOT NULL,
    usage             jsonb,
    provider_metadata jsonb,
    error             text NOT NULL DEFAULT '',
    created_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    UNIQUE (report_id, model_id, question_version),
    UNIQUE (id, report_id)
);

CREATE INDEX IF NOT EXISTS report_jev_runs_report_idx
    ON report_jev_runs (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_jev_runs_mode_status_idx
    ON report_jev_runs (forecast_mode, status, completed_at DESC);

CREATE TABLE IF NOT EXISTS report_jev_predictions (
    run_id          uuid NOT NULL,
    report_id       uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    horizon         text NOT NULL CHECK (horizon IN ('1w', '1m', '3m', '6m', '1y', '3y', '5y')),
    horizon_days    int NOT NULL CHECK (horizon_days > 0),
    probability_up numeric NOT NULL CHECK (probability_up >= 0 AND probability_up <= 1),
    predicted_up    boolean NOT NULL,
    confidence      numeric NOT NULL CHECK (confidence >= 0.5 AND confidence <= 1),
    target_at       timestamptz NOT NULL,
    outcome_status  text NOT NULL DEFAULT 'pending'
                    CHECK (outcome_status IN ('pending', 'realized', 'unavailable')),
    baseline_price  numeric,
    baseline_at     date,
    outcome_price   numeric,
    outcome_at      date,
    realized_up     boolean,
    was_correct     boolean,
    brier_score     numeric CHECK (brier_score >= 0 AND brier_score <= 1),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, horizon),
    UNIQUE (report_id, horizon, run_id),
    FOREIGN KEY (run_id, report_id)
        REFERENCES report_jev_runs(id, report_id) ON DELETE CASCADE,
    CHECK (predicted_up = (probability_up >= 0.5)),
    CHECK (abs(confidence - greatest(probability_up, 1 - probability_up)) < 0.000001),
    CHECK (
        outcome_status <> 'realized'
        OR (
            baseline_price IS NOT NULL AND baseline_at IS NOT NULL
            AND outcome_price IS NOT NULL AND outcome_at IS NOT NULL
            AND realized_up IS NOT NULL AND was_correct IS NOT NULL
            AND brier_score IS NOT NULL
            AND was_correct = (predicted_up = realized_up)
        )
    )
);

CREATE INDEX IF NOT EXISTS report_jev_predictions_report_idx
    ON report_jev_predictions (report_id, horizon);
CREATE INDEX IF NOT EXISTS report_jev_predictions_maturity_idx
    ON report_jev_predictions (outcome_status, target_at)
    WHERE outcome_status = 'pending';
