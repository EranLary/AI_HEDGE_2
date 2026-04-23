"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { listActiveRuns, removeActiveRun, type ClientActiveRun, upsertActiveRun } from "@/lib/active-runs";

type RunStatusApi = {
  job_id: string;
  ticker: string;
  status: "queued" | "running" | "completed" | "failed";
  llm_progress_pct?: number;
  error?: string;
};

type Toast = {
  id: string;
  ticker: string;
  status: "completed" | "failed";
  message: string;
};

function safePct(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

export function ActiveRunIndicator() {
  const [runs, setRuns] = useState<ClientActiveRun[]>(() => listActiveRuns());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const previousStatuses = useRef<Record<string, ClientActiveRun["status"]>>({});

  useEffect(() => {
    let cancelled = false;

    const pollRuns = async () => {
      const current = listActiveRuns();
      if (!current.length) {
        if (!cancelled) {
          setRuns([]);
        }
        return;
      }

      const results = await Promise.allSettled(
        current.map(async (run) => {
          const res = await fetch(`/api/run-analysis/${encodeURIComponent(run.job_id)}`, { cache: "no-store" });
          if (!res.ok) {
            throw new Error(`status ${res.status}`);
          }
          return (await res.json()) as RunStatusApi;
        }),
      );

      const nextRuns: ClientActiveRun[] = [];
      const nextToasts: Toast[] = [];

      for (let i = 0; i < current.length; i += 1) {
        const localRun = current[i];
        const result = results[i];

        if (result.status !== "fulfilled") {
          nextRuns.push(localRun);
          continue;
        }

        const api = result.value;
        const nextStatus = api.status;
        const prevStatus = previousStatuses.current[localRun.job_id] || localRun.status;
        previousStatuses.current[localRun.job_id] = nextStatus;

        if (nextStatus === "completed" || nextStatus === "failed") {
          if (prevStatus === "queued" || prevStatus === "running") {
            nextToasts.push({
              id: `${localRun.job_id}-${Date.now()}`,
              ticker: String(api.ticker || localRun.ticker || "").toUpperCase(),
              status: nextStatus,
              message: nextStatus === "completed" ? "Run completed" : "Run failed",
            });
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

      if (!cancelled) {
        setRuns(nextRuns);
        if (nextToasts.length) {
          setToasts((prev) => [...prev, ...nextToasts].slice(-4));
        }
      }
    };

    pollRuns();
    const timer = setInterval(pollRuns, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!toasts.length) {
      return;
    }
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 5000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const activeRuns = useMemo(
    () => runs.filter((r) => r.status === "queued" || r.status === "running"),
    [runs],
  );
  const topRun = activeRuns[0];

  return (
    <>
      {activeRuns.length ? (
        <div className="sticky top-0 z-50 px-3 pt-2 sm:px-6">
          <div className="hib-active-run-banner mx-auto flex max-w-[1500px] items-center justify-between rounded-xl border px-3 py-2 text-xs backdrop-blur-md">
            <div className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span className="font-medium uppercase tracking-[0.12em]">Active Run</span>
              <span className="hib-active-run-text">
                {topRun?.ticker || "Ticker"} {typeof topRun?.llm_progress_pct === "number" ? `${safePct(topRun.llm_progress_pct).toFixed(1)}%` : ""}
              </span>
              {activeRuns.length > 1 ? <span className="hib-active-run-text">(+{activeRuns.length - 1} more)</span> : null}
            </div>
            <Link href="/" className="hib-active-run-link pointer-events-auto rounded-md border px-2 py-1 text-[11px] uppercase tracking-[0.12em]">
              View Progress
            </Link>
          </div>
        </div>
      ) : null}

      {toasts.length ? (
        <div className="fixed right-3 top-14 z-50 flex w-[300px] flex-col gap-2 sm:right-6">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur-sm ${
                toast.status === "completed"
                  ? "border-emerald-400/50 bg-emerald-500/18 text-emerald-50"
                  : "border-red-400/55 bg-red-500/20 text-red-50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2">
                  {toast.status === "completed" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                  <span className="font-medium">{toast.message}: {toast.ticker}</span>
                </div>
                <Link
                  href={`/dashboard?ticker=${encodeURIComponent(toast.ticker)}`}
                  className="rounded border border-white/30 px-2 py-0.5 text-xs"
                >
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
