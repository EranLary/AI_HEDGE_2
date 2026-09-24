import "server-only";

import { getSql } from "@/lib/db";
import {
  computeJevMetrics,
  JEV_HORIZON_ORDER,
  type JevForecastMode,
  type JevMetrics,
  type JevOutcomeStatus,
  type JevPredictionScope,
} from "@/lib/jev-metrics";
import type { Workspace } from "@/lib/workspace";
import { filterExcludedTickers } from "@/lib/excluded-tickers";

export type { JevForecastMode, JevMetric, JevMetrics, JevOutcomeStatus, JevPredictionScope } from "@/lib/jev-metrics";

// Keep aligned with QUESTION_VERSION in src/ai_hedge/jev.py. Metrics must not
// mix predictions produced by materially different question wording.
export const JEV_QUESTION_VERSION = "stock-direction-v4";

export type JevPrediction = {
  horizon: "1w" | "1m" | "3m" | "6m" | "1y" | "3y" | "5y";
  horizon_days: number;
  probability_up: number;
  predicted_up: boolean;
  confidence: number;
  target_at: string;
  outcome_status: JevOutcomeStatus;
  baseline_price: number | null;
  baseline_at: string | null;
  outcome_price: number | null;
  outcome_at: string | null;
  realized_up: boolean | null;
  was_correct: boolean | null;
  brier_score: number | null;
};

export type JevReportForecast = {
  run_id: string;
  report_id: string;
  model_id: string;
  question_version: string;
  forecast_mode: JevForecastMode;
  status: "pending" | "completed" | "failed";
  input_chars: number;
  input_truncated: boolean;
  redaction_version: string;
  error: string;
  created_at: string;
  completed_at: string | null;
  predictions: JevPrediction[];
};

export type JevDiscoveryRow = {
  report_id: string;
  ticker: string;
  company_name: string;
  report_generated_at: string;
  horizon: JevPrediction["horizon"];
  horizon_days: number;
  probability_up: number;
  predicted_up: boolean;
  confidence: number;
  forecast_mode: JevForecastMode;
};

export type JevDiscoveryRankings = {
  yes: JevDiscoveryRow[];
  no: JevDiscoveryRow[];
  counts: { yes: number; no: number; total: number };
};

type PredictionRow = JevPrediction & {
  run_id: string;
  report_id: string;
};

function normalizeDateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function normalizePrediction(row: Record<string, unknown>): PredictionRow {
  return {
    run_id: String(row.run_id || ""),
    report_id: String(row.report_id || ""),
    horizon: String(row.horizon || "1w") as JevPrediction["horizon"],
    horizon_days: Number(row.horizon_days),
    probability_up: Number(row.probability_up),
    predicted_up: Boolean(row.predicted_up),
    confidence: Number(row.confidence),
    target_at: new Date(String(row.target_at)).toISOString(),
    outcome_status: String(row.outcome_status || "pending") as JevOutcomeStatus,
    baseline_price: row.baseline_price === null ? null : Number(row.baseline_price),
    baseline_at: normalizeDateOnly(row.baseline_at),
    outcome_price: row.outcome_price === null ? null : Number(row.outcome_price),
    outcome_at: normalizeDateOnly(row.outcome_at),
    realized_up: typeof row.realized_up === "boolean" ? row.realized_up : null,
    was_correct: typeof row.was_correct === "boolean" ? row.was_correct : null,
    brier_score: row.brier_score === null ? null : Number(row.brier_score),
  };
}

export async function getJevReportForecast(
  reportId: string,
  workspace: Workspace,
): Promise<JevReportForecast | null> {
  const sql = getSql();
  if (!sql || !reportId) return null;
  const runs = (await sql`
    SELECT j.id::text AS run_id, j.report_id::text AS report_id,
           j.model_id, j.question_version, j.forecast_mode, j.status,
           j.input_chars, j.input_truncated, j.redaction_version, j.error,
           j.created_at, j.completed_at
      FROM report_jev_runs j
      JOIN reports r ON r.id = j.report_id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE j.report_id = ${reportId}::uuid
       AND j.question_version = ${JEV_QUESTION_VERSION}
       AND r.workspace = ${workspace}
       AND r.deleted_at IS NULL
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY j.created_at DESC
     LIMIT 1;
  `) as unknown as Array<Record<string, unknown>>;
  const run = runs[0];
  if (!run) return null;
  const rows = (await sql`
    SELECT p.run_id::text AS run_id, p.report_id::text AS report_id,
           p.horizon, p.horizon_days,
           p.probability_up::float8 AS probability_up,
           p.predicted_up, p.confidence::float8 AS confidence,
           p.target_at, p.outcome_status,
           p.baseline_price::float8 AS baseline_price, p.baseline_at,
           p.outcome_price::float8 AS outcome_price, p.outcome_at,
           p.realized_up, p.was_correct, p.brier_score::float8 AS brier_score
      FROM report_jev_predictions p
     WHERE p.run_id = ${String(run.run_id)}::uuid;
  `) as unknown as Array<Record<string, unknown>>;
  const predictions = rows
    .map(normalizePrediction)
    .sort((a, b) => JEV_HORIZON_ORDER.indexOf(a.horizon) - JEV_HORIZON_ORDER.indexOf(b.horizon));
  return {
    run_id: String(run.run_id),
    report_id: String(run.report_id),
    model_id: String(run.model_id),
    question_version: String(run.question_version),
    forecast_mode: String(run.forecast_mode) as JevForecastMode,
    status: String(run.status) as JevReportForecast["status"],
    input_chars: Number(run.input_chars),
    input_truncated: Boolean(run.input_truncated),
    redaction_version: String(run.redaction_version),
    error: String(run.error || ""),
    created_at: new Date(String(run.created_at)).toISOString(),
    completed_at: run.completed_at ? new Date(String(run.completed_at)).toISOString() : null,
    predictions,
  };
}

export async function getJevMetrics(
  workspace: Workspace,
  mode: JevForecastMode,
  scope: JevPredictionScope,
): Promise<JevMetrics> {
  const sql = getSql();
  if (!sql) return computeJevMetrics([], mode, scope);
  const raw = (await sql`
    SELECT p.run_id::text AS run_id, p.report_id::text AS report_id,
           p.horizon, p.horizon_days,
           p.probability_up::float8 AS probability_up,
           p.predicted_up, p.confidence::float8 AS confidence,
           p.target_at, p.outcome_status,
           p.baseline_price::float8 AS baseline_price, p.baseline_at,
           p.outcome_price::float8 AS outcome_price, p.outcome_at,
           p.realized_up, p.was_correct, p.brier_score::float8 AS brier_score
      FROM report_jev_predictions p
      JOIN report_jev_runs j ON j.id = p.run_id
      JOIN reports r ON r.id = p.report_id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE j.status = 'completed'
       AND j.question_version = ${JEV_QUESTION_VERSION}
       AND j.forecast_mode = ${mode}
       AND r.workspace = ${workspace}
       AND r.deleted_at IS NULL
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'));
  `) as unknown as Array<Record<string, unknown>>;
  const rows = raw.map(normalizePrediction);
  return computeJevMetrics(rows, mode, scope);
}

function normalizeDiscoveryRow(row: Record<string, unknown>): JevDiscoveryRow {
  return {
    report_id: String(row.report_id || ""),
    ticker: String(row.ticker || "").trim().toUpperCase(),
    company_name: String(row.company_name || row.ticker || "").trim(),
    report_generated_at: new Date(String(row.report_generated_at)).toISOString(),
    horizon: String(row.horizon || "1w") as JevDiscoveryRow["horizon"],
    horizon_days: Number(row.horizon_days),
    probability_up: Number(row.probability_up),
    predicted_up: Boolean(row.predicted_up),
    confidence: Number(row.confidence),
    forecast_mode: String(row.forecast_mode) as JevForecastMode,
  };
}

export async function getJevDiscoveryRankings(
  workspace: Workspace,
  horizon: JevPrediction["horizon"] | null,
  limit = 20,
): Promise<JevDiscoveryRankings> {
  const sql = getSql();
  if (!sql) return { yes: [], no: [], counts: { yes: 0, no: 0, total: 0 } };
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const queryLimit = safeLimit + 10;

  const rankedQuery = (predictedUp: boolean) => sql`
    SELECT p.report_id::text AS report_id, r.ticker, r.company_name,
           r.generated_at AS report_generated_at,
           p.horizon, p.horizon_days,
           p.probability_up::float8 AS probability_up,
           p.predicted_up, p.confidence::float8 AS confidence,
           j.forecast_mode
      FROM report_jev_predictions p
      JOIN report_jev_runs j ON j.id = p.run_id
      JOIN reports r ON r.id = p.report_id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE j.status = 'completed'
       AND j.question_version = ${JEV_QUESTION_VERSION}
       AND p.predicted_up = ${predictedUp}
       AND (${horizon}::text IS NULL OR p.horizon = ${horizon})
       AND r.workspace = ${workspace}
       AND r.deleted_at IS NULL
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY p.confidence DESC, r.generated_at DESC, r.ticker ASC, p.horizon_days ASC
     LIMIT ${queryLimit};
  `;

  const [yesRaw, noRaw, countRaw] = await Promise.all([
    rankedQuery(true),
    rankedQuery(false),
    sql`
      SELECT count(*) FILTER (WHERE p.predicted_up)::int AS yes,
             count(*) FILTER (WHERE NOT p.predicted_up)::int AS no,
             count(*)::int AS total
        FROM report_jev_predictions p
        JOIN report_jev_runs j ON j.id = p.run_id
        JOIN reports r ON r.id = p.report_id
        LEFT JOIN report_releases rel ON rel.id = r.release_id
       WHERE j.status = 'completed'
         AND j.question_version = ${JEV_QUESTION_VERSION}
         AND (${horizon}::text IS NULL OR p.horizon = ${horizon})
         AND r.workspace = ${workspace}
         AND r.deleted_at IS NULL
         AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'));
    `,
  ]);

  const clean = (rows: unknown) => filterExcludedTickers(
    (rows as Array<Record<string, unknown>>).map(normalizeDiscoveryRow),
    (row) => row.ticker,
  ).slice(0, safeLimit);
  const count = (countRaw as unknown as Array<Record<string, unknown>>)[0] || {};
  return {
    yes: clean(yesRaw),
    no: clean(noRaw),
    counts: {
      yes: Number(count.yes || 0),
      no: Number(count.no || 0),
      total: Number(count.total || 0),
    },
  };
}
