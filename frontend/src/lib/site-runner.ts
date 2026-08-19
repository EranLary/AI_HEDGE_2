import fs from "node:fs";
import path from "node:path";

export const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export type RunStatusPayload = {
  job_id: string;
  ticker: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  output_dir: string;
  progress_file: string;
  user_id?: string | null;
  attributed?: boolean;
  runner_pid?: number | null;
  worker_pid?: number | null;
  llm_total_estimated?: number;
  llm_completed?: number;
  llm_progress_pct?: number;
  llm_calls_note?: string;
  result?: Record<string, unknown> | null;
  report_id?: string | null;
  persistence_error?: string;
  error?: string;
  traceback?: string;
};

const APP_BOOT_TIME_MS = Date.now();
const APP_BOOT_ISO = new Date(APP_BOOT_TIME_MS).toISOString();
let staleRunsReconciled = false;
let staleRunsReconciledViaSql = false;

export function appBootIso(): string {
  return APP_BOOT_ISO;
}

export function repoRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");
}

export function outputsRoot(): string {
  return path.resolve(repoRoot(), "outputs");
}

export function siteRunsRoot(): string {
  return path.resolve(outputsRoot(), "_site_runs");
}

export function runJobDir(jobId: string): string {
  return path.resolve(siteRunsRoot(), jobId);
}

export function runStatusFile(jobId: string): string {
  return path.resolve(runJobDir(jobId), "_status.json");
}

export function runProgressFile(jobId: string): string {
  return path.resolve(runJobDir(jobId), "_progress.log");
}

export function readRunStatus(jobId: string): RunStatusPayload | null {
  const file = runStatusFile(jobId);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as RunStatusPayload;
    return parsed;
  } catch {
    return null;
  }
}

export function listActiveRunStatusesFromFs(userId: string, limit = 20): RunStatusPayload[] {
  const cleanUserId = String(userId || "").trim();
  if (!cleanUserId) return [];

  const root = siteRunsRoot();
  if (!fs.existsSync(root)) return [];

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs: RunStatusPayload[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const status = readRunStatus(entry.name);
    if (!status) continue;
    if (String(status.user_id || "").trim() !== cleanUserId) continue;
    if (status.status !== "queued" && status.status !== "running") continue;
    runs.push(status);
  }

  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return runs
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, safeLimit);
}

export function readProgressLines(progressPath: string, maxLines = 80): string[] {
  if (!progressPath || !fs.existsSync(progressPath)) {
    return [];
  }
  try {
    const lines = fs
      .readFileSync(progressPath, "utf-8")
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => Boolean(line));
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function parseIsoToMs(value: unknown): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function failStatusDueToRestart(status: RunStatusPayload): RunStatusPayload {
  const restartMsg =
    "Run was interrupted by a server restart/deploy and was auto-marked failed. Please rerun this ticker.";

  const existingError = String(status.error || "").trim();
  const mergedError =
    existingError && !existingError.includes(restartMsg)
      ? `${existingError}\n${restartMsg}`
      : existingError || restartMsg;

  return {
    ...status,
    status: "failed",
    finished_at: new Date().toISOString(),
    error: mergedError,
    persistence_error: String(status.persistence_error || "").trim(),
    result: status.result ?? null,
  };
}

export function reconcileStaleRunsAfterRestart(): void {
  if (staleRunsReconciled) return;
  staleRunsReconciled = true;

  const root = siteRunsRoot();
  if (!fs.existsSync(root)) return;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const statusPath = path.resolve(root, entry.name, "_status.json");
    if (!fs.existsSync(statusPath)) continue;

    try {
      const raw = fs.readFileSync(statusPath, "utf-8");
      const status = JSON.parse(raw) as RunStatusPayload;
      if (status.status !== "running" && status.status !== "queued") continue;

      const startedMs = parseIsoToMs(status.started_at);
      const createdMs = parseIsoToMs(status.created_at);
      const stat = fs.statSync(statusPath);
      const anchorMs = startedMs ?? createdMs ?? stat.mtimeMs;

      // If a run was created/started before this process boot, it cannot still be alive.
      if (anchorMs <= APP_BOOT_TIME_MS - 1000) {
        const failed = failStatusDueToRestart(status);
        fs.writeFileSync(statusPath, JSON.stringify(failed, null, 2), "utf-8");
      }
    } catch {
      // best effort; never block request flow.
      continue;
    }
  }

  // Best effort marker for diagnostics.
  try {
    const marker = path.resolve(root, "_reconciled_at_startup.json");
    fs.writeFileSync(
      marker,
      JSON.stringify({ reconciled_at: new Date().toISOString(), app_boot_at: APP_BOOT_ISO }, null, 2),
      "utf-8",
    );
  } catch {
    // ignore marker failures
  }
}

/**
 * SQL-based equivalent of `reconcileStaleRunsAfterRestart`. Runs at most once
 * per process so we don't re-fire on every request. Best-effort — when Neon is
 * unreachable the FS reconciler still runs above and is authoritative until
 * Phase 2 drops the FS sink.
 */
export async function reconcileStaleRunsViaSql(): Promise<void> {
  if (staleRunsReconciledViaSql) return;
  staleRunsReconciledViaSql = true;
  const { failStaleRunsViaSql } = await import("@/lib/site-runs-db");
  await failStaleRunsViaSql({ appBootAt: APP_BOOT_ISO });
}
