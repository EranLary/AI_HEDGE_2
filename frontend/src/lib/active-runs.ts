"use client";

export type ClientRunStatus = "queued" | "running" | "completed" | "failed";

export type ClientActiveRun = {
  job_id: string;
  ticker: string;
  status: ClientRunStatus;
  llm_progress_pct?: number;
  created_at: string;
  updated_at?: string;
};

const ACTIVE_RUNS_KEY = "hib-active-runs-v1";

function isClientActiveRun(value: unknown): value is ClientActiveRun {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Partial<ClientActiveRun>;
  return (
    typeof v.job_id === "string" &&
    typeof v.ticker === "string" &&
    typeof v.status === "string" &&
    typeof v.created_at === "string"
  );
}

function safeWindow(): Window | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window;
}

export function listActiveRuns(): ClientActiveRun[] {
  const w = safeWindow();
  if (!w) {
    return [];
  }
  try {
    const raw = w.localStorage.getItem(ACTIVE_RUNS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isClientActiveRun);
  } catch {
    return [];
  }
}

function saveActiveRuns(runs: ClientActiveRun[]): void {
  const w = safeWindow();
  if (!w) {
    return;
  }
  try {
    const unique = new Map<string, ClientActiveRun>();
    for (const run of runs) {
      unique.set(run.job_id, run);
    }
    w.localStorage.setItem(ACTIVE_RUNS_KEY, JSON.stringify(Array.from(unique.values())));
  } catch {
    // no-op
  }
}

export function upsertActiveRun(run: ClientActiveRun): void {
  const runs = listActiveRuns();
  const nowIso = new Date().toISOString();
  const next = {
    ...run,
    ticker: String(run.ticker || "").toUpperCase(),
    updated_at: nowIso,
  };
  const idx = runs.findIndex((r) => r.job_id === run.job_id);
  if (idx >= 0) {
    runs[idx] = { ...runs[idx], ...next };
  } else {
    runs.push(next);
  }
  saveActiveRuns(runs);
}

export function removeActiveRun(jobId: string): void {
  const runs = listActiveRuns().filter((r) => r.job_id !== jobId);
  saveActiveRuns(runs);
}

export function clearFinishedRuns(): void {
  const runs = listActiveRuns().filter((r) => r.status === "queued" || r.status === "running");
  saveActiveRuns(runs);
}

