"use client";

import { listActiveRuns, removeActiveRun, upsertActiveRun, type ClientActiveRun } from "@/lib/active-runs";

type RunStatusApi = {
  job_id: string;
  ticker: string;
  status: "queued" | "running" | "completed" | "failed";
  llm_progress_pct?: number;
  error?: string;
};

export type CompletionEvent = {
  job_id: string;
  ticker: string;
  status: "completed" | "failed";
};

type RunsListener = (runs: ClientActiveRun[]) => void;
type CompletionListener = (event: CompletionEvent) => void;

const runsListeners = new Set<RunsListener>();
const completionListeners = new Set<CompletionListener>();
const previousStatuses: Record<string, ClientActiveRun["status"]> = {};

let latestRuns: ClientActiveRun[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let polling = false;

function safePct(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function emit() {
  for (const listener of runsListeners) listener(latestRuns);
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const current = listActiveRuns();
    if (!current.length) {
      latestRuns = [];
      emit();
      return;
    }

    const results = await Promise.allSettled(
      current.map(async (run) => {
        const res = await fetch(`/api/run-analysis/${encodeURIComponent(run.job_id)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as RunStatusApi;
      }),
    );

    const nextRuns: ClientActiveRun[] = [];
    for (let i = 0; i < current.length; i += 1) {
      const localRun = current[i];
      const result = results[i];
      if (result.status !== "fulfilled") {
        nextRuns.push(localRun);
        continue;
      }
      const api = result.value;
      const nextStatus = api.status;
      const prevStatus = previousStatuses[localRun.job_id] || localRun.status;
      previousStatuses[localRun.job_id] = nextStatus;

      if (nextStatus === "completed" || nextStatus === "failed") {
        if (prevStatus === "queued" || prevStatus === "running") {
          const event: CompletionEvent = {
            job_id: localRun.job_id,
            ticker: String(api.ticker || localRun.ticker || "").toUpperCase(),
            status: nextStatus,
          };
          for (const listener of completionListeners) listener(event);
        }
        removeActiveRun(localRun.job_id);
        continue;
      }

      const updated: ClientActiveRun = {
        ...localRun,
        ticker: String(api.ticker || localRun.ticker || "").toUpperCase(),
        status: nextStatus,
        llm_progress_pct: safePct(api.llm_progress_pct),
        updated_at: new Date().toISOString(),
      };
      upsertActiveRun(updated);
      nextRuns.push(updated);
    }
    latestRuns = nextRuns;
    emit();
  } finally {
    polling = false;
  }
}

function ensureTimer() {
  if (timer != null) return;
  pollOnce();
  timer = setInterval(pollOnce, 3000);
}

function maybeStopTimer() {
  if (timer != null && runsListeners.size === 0 && completionListeners.size === 0) {
    clearInterval(timer);
    timer = null;
  }
}

export function subscribeActiveRuns(listener: RunsListener): () => void {
  runsListeners.add(listener);
  listener(latestRuns.length ? latestRuns : listActiveRuns());
  ensureTimer();
  return () => {
    runsListeners.delete(listener);
    maybeStopTimer();
  };
}

export function subscribeRunCompletion(listener: CompletionListener): () => void {
  completionListeners.add(listener);
  ensureTimer();
  return () => {
    completionListeners.delete(listener);
    maybeStopTimer();
  };
}

export function getActiveRunsSnapshot(): ClientActiveRun[] {
  return latestRuns.length ? latestRuns : listActiveRuns();
}

export function nudgeActiveRuns(): void {
  latestRuns = listActiveRuns();
  emit();
  if (timer != null) pollOnce();
}

export async function cancelActiveRun(jobId: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const cleanJobId = String(jobId || "").trim();
  if (!cleanJobId) {
    return { ok: false, error: "Missing job id." };
  }

  try {
    const res = await fetch(`/api/run-analysis/${encodeURIComponent(cleanJobId)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
    if (!res.ok || !json.ok) {
      return { ok: false, error: String(json.error || "Failed to stop run.") };
    }

    removeActiveRun(cleanJobId);
    latestRuns = listActiveRuns();
    emit();
    return { ok: true, message: String(json.message || "") };
  } catch {
    return { ok: false, error: "Failed to stop run." };
  }
}
