import "server-only";

import { randomUUID } from "node:crypto";

import { getSql } from "@/lib/db";
import type { NasdaqAdmin } from "@/lib/nasdaq-admin";
import {
  configuredNasdaqBudget,
  configuredNasdaqConcurrency,
  configuredNasdaqCostPerAttempt,
} from "@/lib/nasdaq-execution-policy";
import { deduplicateNasdaqIssuerStocks, selectNasdaqRunStocks } from "@/lib/nasdaq-run-policy";
import type { NasdaqUniverseSnapshot, NasdaqUniverseStock } from "@/lib/nasdaq-universe";

export type NasdaqRunMode = "all" | "selected" | "missing_week";
export type NasdaqRunStatus = "queued" | "running" | "completed" | "partial" | "failed" | "stopped";

export type NasdaqRunSummary = {
  id: string;
  releaseId: string;
  requestedMode: NasdaqRunMode;
  effectiveMode: "all" | "selected" | "missing_week" | "resume_week";
  status: NasdaqRunStatus;
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  stoppedCount: number;
  stoppedBeforeStartCount: number;
  stoppedAfterAttemptCount: number;
  retryPendingCount: number;
  activeCount: number;
  leadingTicker: string;
  leadingProgressPct: number;
  concurrency: number;
  estimatedCostPerAttemptUsd: number;
  estimatedCostUsd: number;
  observedCostUsd: number;
  budgetLimitUsd: number;
  stopRequestedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string;
};

export class NasdaqRunConflictError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "NasdaqRunConflictError";
    this.status = status;
  }
}

type RunRow = {
  id: string;
  release_id: string;
  requested_mode: NasdaqRunMode;
  effective_mode: NasdaqRunSummary["effectiveMode"];
  status: NasdaqRunStatus;
  requested_count: number;
  completed_count: number;
  failed_count: number;
  stopped_count: number;
  stopped_before_start_count: number;
  stopped_after_attempt_count: number;
  retry_pending_count: number;
  active_count: number;
  leading_ticker?: string | null;
  leading_progress_pct?: number | null;
  concurrency: number;
  estimated_cost_per_attempt_usd: number;
  estimated_cost_usd: number;
  observed_cost_usd: number;
  budget_limit_usd: number;
  stop_requested_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string;
};

type ResumeRow = {
  release_id: string;
  universe_source: string;
  universe_as_of: string | null;
  universe_snapshot: unknown;
};

function requireSql() {
  const sql = getSql();
  if (!sql) throw new NasdaqRunConflictError("Database access is required for universe runs.", 503);
  return sql;
}

function asUuid(value: string | null): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function toSummary(row: RunRow): NasdaqRunSummary {
  return {
    id: row.id,
    releaseId: row.release_id,
    requestedMode: row.requested_mode,
    effectiveMode: row.effective_mode,
    status: row.status,
    requestedCount: Number(row.requested_count || 0),
    completedCount: Number(row.completed_count || 0),
    failedCount: Number(row.failed_count || 0),
    stoppedCount: Number(row.stopped_count || 0),
    stoppedBeforeStartCount: Number(row.stopped_before_start_count || 0),
    stoppedAfterAttemptCount: Number(row.stopped_after_attempt_count || 0),
    retryPendingCount: Number(row.retry_pending_count || 0),
    activeCount: Number(row.active_count || 0),
    leadingTicker: String(row.leading_ticker || ""),
    leadingProgressPct: Math.max(0, Math.min(100, Number(row.leading_progress_pct || 0))),
    concurrency: Number(row.concurrency || 1),
    estimatedCostPerAttemptUsd: Number(row.estimated_cost_per_attempt_usd || 0),
    estimatedCostUsd: Number(row.estimated_cost_usd || 0),
    observedCostUsd: Number(row.observed_cost_usd || 0),
    budgetLimitUsd: Number(row.budget_limit_usd || 0),
    stopRequestedAt: row.stop_requested_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error || "",
  };
}

export async function reconcileStaleNasdaqRuns(): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;
  try {
    const rows = (await sql`
      WITH stale_ids AS MATERIALIZED (
        SELECT id
          FROM nasdaq_universe_runs
         WHERE status IN ('queued', 'running')
           AND coalesce(heartbeat_at, started_at, created_at) < now() - interval '15 minutes'
         FOR UPDATE
      ), stopped_items AS (
        UPDATE nasdaq_universe_run_items item
           SET status = 'stopped',
               finished_at = coalesce(item.finished_at, now()),
               worker_id = NULL,
               lease_expires_at = NULL,
               final_status_reason = 'Interrupted before completion; eligible for a seven-day resume.'
          FROM stale_ids stale
         WHERE item.run_id = stale.id
           AND item.status IN ('pending', 'running')
        RETURNING item.run_id
      ), stopped_attempts AS (
        UPDATE nasdaq_universe_run_attempts attempt
           SET status = 'stopped',
               finished_at = coalesce(attempt.finished_at, now()),
               error = CASE WHEN attempt.error = ''
                 THEN 'Interrupted before the attempt was finalized.'
                 ELSE attempt.error END
          FROM stale_ids stale
         WHERE attempt.run_id = stale.id
           AND attempt.status = 'running'
        RETURNING attempt.run_id
      ), counts AS (
        SELECT stale.id, run.release_id, run.requested_count, run.universe_count,
               count(*) FILTER (WHERE item.status = 'completed')::int AS completed_count,
               count(*) FILTER (WHERE item.status = 'failed')::int AS failed_count,
               count(*) FILTER (WHERE item.status IN ('stopped', 'pending', 'running'))::int AS stopped_count
          FROM stale_ids stale
          JOIN nasdaq_universe_runs run ON run.id = stale.id
          LEFT JOIN nasdaq_universe_run_items item ON item.run_id = stale.id
         GROUP BY stale.id, run.release_id, run.requested_count, run.universe_count
      ), report_counts AS (
        SELECT counts.id, count(DISTINCT reports.ticker)::int AS release_report_count
          FROM counts
          LEFT JOIN reports ON reports.release_id = counts.release_id
            AND reports.workspace = 'nasdaq100' AND reports.deleted_at IS NULL
         GROUP BY counts.id
      ), updated_runs AS (
        UPDATE nasdaq_universe_runs run
         SET status = CASE
             WHEN counts.requested_count > 0 AND counts.completed_count = counts.requested_count THEN 'completed'
               ELSE 'stopped'
             END,
             completed_count = counts.completed_count,
             failed_count = counts.failed_count,
             stopped_count = counts.stopped_count,
             finished_at = coalesce(run.finished_at, now()),
             error = CASE
               WHEN counts.requested_count > 0 AND counts.completed_count = counts.requested_count THEN ''
               WHEN run.error = '' THEN 'Universe run was interrupted. Completed reports remain available; rerun within seven days to continue.'
               ELSE run.error END
        FROM counts
        WHERE run.id = counts.id
        RETURNING run.id, run.release_id, run.status
      ), activated_releases AS (
        UPDATE report_releases release
           SET status = 'active',
               coverage_complete = report_counts.release_report_count >= counts.universe_count
          FROM updated_runs, counts, report_counts
         WHERE release.id = updated_runs.release_id
           AND counts.id = updated_runs.id
           AND report_counts.id = updated_runs.id
           AND updated_runs.status = 'completed'
      )
      SELECT id::text AS id FROM updated_runs;
    `) as unknown as Array<{ id: string }>;
    return rows.length;
  } catch (error) {
    console.warn("[nasdaq-runs-db] stale-run reconciliation failed:", error);
    return 0;
  }
}

export async function listNasdaqRuns(limit = 5): Promise<NasdaqRunSummary[]> {
  const sql = requireSql();
  const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
  const rows = (await sql`
    SELECT id::text AS id, release_id::text AS release_id,
           requested_mode, effective_mode, status,
           requested_count, completed_count, failed_count, stopped_count,
           (SELECT count(*)::int FROM nasdaq_universe_run_items item
             WHERE item.run_id = nasdaq_universe_runs.id
               AND item.status = 'stopped' AND item.attempts = 0) AS stopped_before_start_count,
           (SELECT count(*)::int FROM nasdaq_universe_run_items item
             WHERE item.run_id = nasdaq_universe_runs.id
               AND item.status = 'stopped' AND item.attempts > 0) AS stopped_after_attempt_count,
           (SELECT count(*)::int FROM nasdaq_universe_run_items item
             WHERE item.run_id = nasdaq_universe_runs.id
               AND item.status = 'pending' AND item.attempts > 0) AS retry_pending_count,
           (SELECT count(*)::int FROM nasdaq_universe_run_items item
             WHERE item.run_id = nasdaq_universe_runs.id AND item.status = 'running') AS active_count,
           progress.leading_ticker,
           coalesce(progress.leading_progress_pct, 0)::float8 AS leading_progress_pct,
           concurrency, estimated_cost_per_attempt_usd::float8,
           estimated_cost_usd::float8, observed_cost_usd::float8,
           budget_limit_usd::float8, stop_requested_at::text,
           created_at::text AS created_at,
           started_at::text AS started_at,
           finished_at::text AS finished_at,
           error
      FROM nasdaq_universe_runs
      LEFT JOIN LATERAL (
        SELECT site_run.ticker AS leading_ticker,
               CASE WHEN site_run.llm_total_estimated > 0
                 THEN least(
                   100.0,
                   greatest(0.0, site_run.llm_completed::float8 * 100.0 / site_run.llm_total_estimated)
                 )
                 ELSE 0.0
               END AS leading_progress_pct
          FROM site_runs site_run
         WHERE site_run.batch_id = nasdaq_universe_runs.id
           AND site_run.workspace = 'nasdaq100'
           AND site_run.status IN ('queued', 'running')
         ORDER BY leading_progress_pct DESC, site_run.created_at DESC
         LIMIT 1
      ) progress ON true
     ORDER BY created_at DESC
     LIMIT ${safeLimit};
  `) as unknown as RunRow[];
  return rows.map(toSummary);
}

export async function failNasdaqRunSpawn(runId: string, error: string): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  await sql`
    UPDATE nasdaq_universe_runs
       SET status = 'failed', finished_at = now(), heartbeat_at = now(), error = ${error.slice(0, 4000)}
     WHERE id = ${runId}::uuid
       AND status IN ('queued', 'running');
  `;
}

export async function requestNasdaqRunStop(runId: string): Promise<boolean> {
  const sql = requireSql();
  const cleanId = asUuid(runId);
  if (!cleanId) throw new NasdaqRunConflictError("Invalid universe run id.", 400);
  const rows = (await sql`
    UPDATE nasdaq_universe_runs
       SET stop_requested_at = coalesce(stop_requested_at, now()),
           heartbeat_at = now()
     WHERE id = ${cleanId}::uuid
       AND status IN ('queued', 'running')
    RETURNING id::text AS id;
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

async function recentResume(): Promise<ResumeRow | null> {
  const sql = requireSql();
  const rows = (await sql`
    SELECT run.release_id::text AS release_id,
           run.universe_source,
           run.universe_as_of::text AS universe_as_of,
           run.universe_snapshot
      FROM nasdaq_universe_runs run
      JOIN report_releases release ON release.id = run.release_id
     WHERE run.status IN ('partial', 'failed', 'stopped')
       AND run.created_at >= now() - interval '7 days'
       AND (run.requested_mode IN ('all', 'missing_week') OR run.effective_mode = 'resume_week')
       AND release.status = 'running'
     ORDER BY run.created_at DESC
     LIMIT 1;
  `) as unknown as ResumeRow[];
  return rows[0] || null;
}

function snapshotStocks(value: unknown): NasdaqUniverseStock[] {
  if (!Array.isArray(value)) return [];
  const stocks = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const ticker = String(row.ticker || "").trim().toUpperCase();
    if (!ticker) return [];
    const aliases = Array.isArray(row.aliases)
      ? row.aliases.map((alias) => String(alias || "").trim().toUpperCase()).filter(Boolean)
      : undefined;
    return [{
      ticker,
      companyName: String(row.companyName || row.company_name || ticker),
      rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
      aliases,
    }];
  });
  return deduplicateNasdaqIssuerStocks(stocks);
}

async function completedTickersForRelease(releaseId: string): Promise<Set<string>> {
  const sql = requireSql();
  const rows = (await sql`
    SELECT DISTINCT ticker
      FROM reports
     WHERE workspace = 'nasdaq100'
       AND release_id = ${releaseId}::uuid
       AND deleted_at IS NULL;
  `) as unknown as Array<{ ticker: string }>;
  return new Set(rows.map((row) => row.ticker.toUpperCase()));
}

async function tickersRunInLastWeek(): Promise<Set<string>> {
  const sql = requireSql();
  const rows = (await sql`
    SELECT DISTINCT ticker
      FROM reports
     WHERE workspace = 'nasdaq100'
       AND deleted_at IS NULL
       AND available_at >= now() - interval '7 days';
  `) as unknown as Array<{ ticker: string }>;
  return new Set(rows.map((row) => row.ticker.toUpperCase()));
}

export async function createNasdaqRun(opts: {
  admin: NasdaqAdmin;
  mode: NasdaqRunMode;
  selectedTickers?: string[];
  universe: NasdaqUniverseSnapshot;
}): Promise<{ run: NasdaqRunSummary; resumed: boolean }> {
  const sql = requireSql();
  await reconcileStaleNasdaqRuns();

  const live = (await sql`
    SELECT id::text AS id
      FROM nasdaq_universe_runs
     WHERE status IN ('queued', 'running')
     LIMIT 1;
  `) as unknown as Array<{ id: string }>;
  if (live.length) throw new NasdaqRunConflictError("A Nasdaq 100 universe run is already in progress.");

  let releaseId: string | null = null;
  let effectiveMode: NasdaqRunSummary["effectiveMode"] = opts.mode;
  let source = opts.universe.source;
  let asOf = opts.universe.asOf;
  let stocks = opts.universe.stocks;
  let resumed = false;
  let resumedSnapshot: NasdaqUniverseStock[] | null = null;

  if (opts.mode === "all" || opts.mode === "missing_week") {
    const resume = await recentResume();
    if (resume) {
      const previousStocks = snapshotStocks(resume.universe_snapshot);
      if (previousStocks.length) {
        stocks = previousStocks;
        resumedSnapshot = previousStocks;
      }
      releaseId = resume.release_id;
      source = resume.universe_source;
      asOf = resume.universe_as_of;
      const completed = await completedTickersForRelease(releaseId);
      const recent = opts.mode === "missing_week" ? await tickersRunInLastWeek() : undefined;
      stocks = selectNasdaqRunStocks(stocks, {
        mode: opts.mode,
        recentlyCompletedTickers: recent,
        resumedReleaseTickers: completed,
      });
      effectiveMode = "resume_week";
      resumed = true;
    } else if (opts.mode === "missing_week") {
      const recent = await tickersRunInLastWeek();
      stocks = selectNasdaqRunStocks(stocks, { mode: opts.mode, recentlyCompletedTickers: recent });
    }
  } else if (opts.mode === "selected") {
    stocks = selectNasdaqRunStocks(stocks, { mode: opts.mode, selectedTickers: opts.selectedTickers });
  }

  if (!stocks.length) {
    throw new NasdaqRunConflictError(
      opts.mode === "selected" ? "Select at least one Nasdaq 100 stock." : "There are no eligible stocks to run.",
      422,
    );
  }

  const runId = randomUUID();
  const createdReleaseId = releaseId || randomUUID();
  const fullSnapshot = resumed ? (resumedSnapshot || []) : opts.universe.stocks;
  const universeSnapshot = fullSnapshot.length ? fullSnapshot : opts.universe.stocks;
  const itemPayload = stocks.map((stock) => ({ ticker: stock.ticker, company_name: stock.companyName }));
  const releaseKey = `universe-${new Date().toISOString().replace(/[:.]/g, "-")}-${runId.slice(0, 8)}`;
  const userId = asUuid(opts.admin.userId);
  const universeAsOf = asOf && Number.isFinite(Date.parse(asOf)) ? asOf : null;
  const concurrency = configuredNasdaqConcurrency();
  const estimatedCostPerAttempt = configuredNasdaqCostPerAttempt();
  const budgetLimit = configuredNasdaqBudget();

  let rows: RunRow[];
  try {
    if (releaseId) {
      rows = (await sql`
        WITH inserted_run AS (
          INSERT INTO nasdaq_universe_runs (
            id, release_id, requested_by_user_id, requested_by_email,
            requested_mode, effective_mode, status,
            universe_source, universe_as_of, universe_snapshot,
            universe_count, requested_count, max_attempts, heartbeat_at,
            concurrency, estimated_cost_per_attempt_usd, budget_limit_usd
          ) VALUES (
            ${runId}::uuid, ${createdReleaseId}::uuid, ${userId}::uuid, ${opts.admin.email},
            ${opts.mode}, ${effectiveMode}, 'queued',
            ${source}, ${universeAsOf}::timestamptz, ${JSON.stringify(universeSnapshot)}::jsonb,
            ${universeSnapshot.length}, ${stocks.length}, 3, now(),
            ${concurrency}, ${estimatedCostPerAttempt}, ${budgetLimit}
          )
          RETURNING *
        ), inserted_items AS (
          INSERT INTO nasdaq_universe_run_items (run_id, ticker, company_name)
          SELECT ${runId}::uuid, item.ticker, item.company_name
            FROM jsonb_to_recordset(${JSON.stringify(itemPayload)}::jsonb)
              AS item(ticker text, company_name text)
        )
        SELECT id::text AS id, release_id::text AS release_id,
               requested_mode, effective_mode, status,
               requested_count, completed_count, failed_count, stopped_count,
               0::int AS stopped_before_start_count,
               0::int AS stopped_after_attempt_count,
               0::int AS retry_pending_count,
               0::int AS active_count, concurrency,
               estimated_cost_per_attempt_usd::float8,
               estimated_cost_usd::float8, observed_cost_usd::float8,
               budget_limit_usd::float8, stop_requested_at::text,
               created_at::text AS created_at,
               started_at::text AS started_at,
               finished_at::text AS finished_at, error
          FROM inserted_run;
      `) as unknown as RunRow[];
    } else {
      rows = (await sql`
        WITH inserted_release AS (
          INSERT INTO report_releases (id, workspace, release_key, status, activated_at)
          VALUES (${createdReleaseId}::uuid, 'nasdaq100', ${releaseKey}, 'running', now())
          RETURNING id
        ), inserted_run AS (
          INSERT INTO nasdaq_universe_runs (
            id, release_id, requested_by_user_id, requested_by_email,
            requested_mode, effective_mode, status,
            universe_source, universe_as_of, universe_snapshot,
            universe_count, requested_count, max_attempts, heartbeat_at,
            concurrency, estimated_cost_per_attempt_usd, budget_limit_usd
          )
          SELECT ${runId}::uuid, inserted_release.id, ${userId}::uuid, ${opts.admin.email},
                 ${opts.mode}, ${effectiveMode}, 'queued',
                 ${source}, ${universeAsOf}::timestamptz, ${JSON.stringify(universeSnapshot)}::jsonb,
                 ${universeSnapshot.length}, ${stocks.length}, 3, now(),
                 ${concurrency}, ${estimatedCostPerAttempt}, ${budgetLimit}
            FROM inserted_release
          RETURNING *
        ), inserted_items AS (
          INSERT INTO nasdaq_universe_run_items (run_id, ticker, company_name)
          SELECT ${runId}::uuid, item.ticker, item.company_name
            FROM jsonb_to_recordset(${JSON.stringify(itemPayload)}::jsonb)
              AS item(ticker text, company_name text)
        )
        SELECT id::text AS id, release_id::text AS release_id,
               requested_mode, effective_mode, status,
               requested_count, completed_count, failed_count, stopped_count,
               0::int AS stopped_before_start_count,
               0::int AS stopped_after_attempt_count,
               0::int AS retry_pending_count,
               0::int AS active_count, concurrency,
               estimated_cost_per_attempt_usd::float8,
               estimated_cost_usd::float8, observed_cost_usd::float8,
               budget_limit_usd::float8, stop_requested_at::text,
               created_at::text AS created_at,
               started_at::text AS started_at,
               finished_at::text AS finished_at, error
          FROM inserted_run;
      `) as unknown as RunRow[];
    }
  } catch (error) {
    const message = String(error);
    if (message.includes("nasdaq_universe_one_live_run_idx")) {
      throw new NasdaqRunConflictError("A Nasdaq 100 universe run is already in progress.");
    }
    throw error;
  }

  if (!rows[0]) throw new NasdaqRunConflictError("Failed to create the universe run.", 500);
  return { run: toSummary(rows[0]), resumed };
}
