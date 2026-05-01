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
