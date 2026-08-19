import { getSql } from "@/lib/db";
import type { RunStatusPayload } from "@/lib/site-runner";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !UUID_RE.test(trimmed)) return null;
  return trimmed;
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

interface SiteRunRow {
  job_id: string;
  ticker: string;
  user_id: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  llm_total_estimated: number;
  llm_completed: number;
  error: string;
  report_id: string | null;
}

function rowToRunStatus(row: SiteRunRow): Partial<RunStatusPayload> {
  const llmTotal = asNumber(row.llm_total_estimated, 30);
  const llmDone = asNumber(row.llm_completed, 0);
  const llmPct = llmTotal > 0 ? Math.min(100, Number(((llmDone / llmTotal) * 100).toFixed(2))) : 0;

  return {
    job_id: row.job_id,
    ticker: row.ticker,
    status: row.status as RunStatusPayload["status"],
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    user_id: row.user_id,
    llm_total_estimated: llmTotal,
    llm_completed: llmDone,
    llm_progress_pct: llmPct,
    error: row.error || "",
    report_id: row.report_id,
  };
}

/**
 * Insert the row for a freshly-queued run. Best-effort: returns false on any
 * failure so the FS sink keeps running. The Python worker will UPSERT the same
 * row on its first status write.
 */
export async function insertQueuedRun(opts: {
  jobId: string;
  ticker: string;
  userId: string | null;
  llmTotalEstimated: number;
  bootAnchorAt: string;
}): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  try {
    await sql`
      INSERT INTO site_runs (
        job_id, ticker, user_id, status,
        llm_total_estimated, boot_anchor_at
      ) VALUES (
        ${opts.jobId},
        ${opts.ticker.toUpperCase()},
        ${asUuid(opts.userId)}::uuid,
        'queued',
        ${Math.max(1, Math.trunc(opts.llmTotalEstimated))},
        ${opts.bootAnchorAt}::timestamptz
      )
      ON CONFLICT (job_id) DO NOTHING;
    `;
    return true;
  } catch (err) {
    console.warn(`[site-runs-db] insertQueuedRun failed for ${opts.jobId}:`, err);
    return false;
  }
}

/**
 * Read the canonical run row from Neon. Returns null when the row is missing
 * or the DB is unreachable; the GET endpoint then falls back to the FS sink.
 *
 * The shape mirrors the FS payload so the existing consumer code works
 * unchanged. Fields the FS sink owns but the table does not (output_dir,
 * progress_file, runner_pid, worker_pid, etc.) are filled in by the caller
 * from the FS payload when both are present.
 */
export async function readRunStatusFromDb(jobId: string): Promise<Partial<RunStatusPayload> | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT job_id, ticker,
             user_id::text AS user_id,
             status,
             created_at::text AS created_at,
             started_at::text AS started_at,
             finished_at::text AS finished_at,
             llm_total_estimated, llm_completed,
             error,
             report_id::text AS report_id
        FROM site_runs
       WHERE job_id = ${jobId}
       LIMIT 1;
    `) as unknown as SiteRunRow[];
    const row = rows[0];
    if (!row) return null;

    return rowToRunStatus(row);
  } catch (err) {
    console.warn(`[site-runs-db] readRunStatusFromDb failed for ${jobId}:`, err);
    return null;
  }
}

/**
 * Return the active runs owned by one signed-in user. A null result means the
 * durable store is unavailable; an empty array is a successful query with no
 * active runs. Keeping those cases distinct lets callers use the FS fallback
 * only when it is actually needed.
 */
export async function listActiveRunsForUser(
  userId: string,
  limit = 20,
): Promise<Partial<RunStatusPayload>[] | null> {
  const sql = getSql();
  const cleanUserId = asUuid(userId);
  if (!sql || !cleanUserId) return null;
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));

  try {
    const rows = (await sql`
      SELECT job_id, ticker,
             user_id::text AS user_id,
             status,
             created_at::text AS created_at,
             started_at::text AS started_at,
             finished_at::text AS finished_at,
             llm_total_estimated, llm_completed,
             error,
             report_id::text AS report_id
        FROM site_runs
       WHERE user_id = ${cleanUserId}::uuid
         AND status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT ${safeLimit};
    `) as unknown as SiteRunRow[];
    return rows.map(rowToRunStatus);
  } catch (err) {
    console.warn(`[site-runs-db] listActiveRunsForUser failed for ${cleanUserId}:`, err);
    return null;
  }
}

/**
 * Mirror a Node-side status transition into Neon. Used by cancel/spawn-failure
 * paths that update FS without going through the Python worker.
 */
export async function updateRunStatusFromNode(opts: {
  jobId: string;
  status: RunStatusPayload["status"];
  finishedAt?: string | null;
  error?: string;
}): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  const finishedAt = opts.finishedAt ?? null;
  const error = opts.error ?? "";
  try {
    await sql`
      UPDATE site_runs
         SET status      = ${opts.status},
             finished_at = COALESCE(${finishedAt}::timestamptz, finished_at),
             error       = ${error}
       WHERE job_id = ${opts.jobId};
    `;
  } catch (err) {
    console.warn(`[site-runs-db] updateRunStatusFromNode failed for ${opts.jobId}:`, err);
  }
}

/**
 * Mark every queued/running row from a previous app boot as failed. Mirrors
 * the FS-based `reconcileStaleRunsAfterRestart` so the two sinks stay in sync.
 *
 * Compares each row's `boot_anchor_at` (set when the row was created, equal to
 * the Node app's boot time at insert) against the current app boot time. Any
 * row anchored to an older boot cannot still be alive — the spawned Python
 * worker died with the previous container.
 */
export async function failStaleRunsViaSql(opts: {
  appBootAt: string;
  reason?: string;
}): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;
  const reason = (opts.reason || "Run was interrupted by a server restart/deploy and was auto-marked failed. Please rerun this ticker.").trim();
  try {
    const rows = (await sql`
      UPDATE site_runs
         SET status      = 'failed',
             finished_at = COALESCE(finished_at, now()),
             error       = CASE
               WHEN error IS NULL OR error = '' THEN ${reason}
               WHEN position(${reason} IN error) > 0 THEN error
               ELSE error || E'\n' || ${reason}
             END
       WHERE status IN ('queued', 'running')
         AND boot_anchor_at < ${opts.appBootAt}::timestamptz
       RETURNING job_id;
    `) as Array<{ job_id: string }>;
    if (rows.length) {
      console.info(`[site-runs-db] reconciled ${rows.length} stale run(s) from prior boot`);
    }
    return rows.length;
  } catch (err) {
    console.warn(`[site-runs-db] failStaleRunsViaSql failed:`, err);
    return 0;
  }
}
