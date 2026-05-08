"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import type { ClientActiveRun } from "@/lib/active-runs";
import { getProgressStep } from "@/lib/run-progress";
import {
  cancelActiveRun,
  getActiveRunsSnapshot,
  subscribeActiveRuns,
  subscribeRunCompletion,
  type CompletionEvent,
} from "@/components/shell/active-runs-store";

type Toast = {
  id: string;
  ticker: string;
  status: "completed" | "failed";
  message: string;
};

function safePct(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function ActiveRunIndicator() {
  const [runs, setRuns] = useState<ClientActiveRun[]>(() => getActiveRunsSnapshot());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stoppingJobId, setStoppingJobId] = useState<string>("");

  useEffect(() => subscribeActiveRuns(setRuns), []);

  useEffect(() => {
    return subscribeRunCompletion((event: CompletionEvent) => {
      setToasts((prev) =>
        [
          ...prev,
          {
            id: `${event.job_id}-${Date.now()}`,
            ticker: event.ticker,
            status: event.status,
            message: event.status === "completed" ? "Run completed" : "Run failed",
          },
        ].slice(-4),
      );
    });
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
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
  const topPct = safePct(topRun?.llm_progress_pct);
  const topStep = getProgressStep(topPct);
  const topRunStopping = Boolean(topRun?.job_id && stoppingJobId === topRun.job_id);

  return (
    <>
      {activeRuns.length ? (
        <div className="px-3 pt-2 sm:px-6">
          <div className="hib-active-run-banner mx-auto flex max-w-[1500px] items-center rounded-xl border px-3 py-2 text-xs backdrop-blur-md">
            <div className="w-full">
              <div className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                <span className="font-medium uppercase tracking-[0.12em]">Active Run</span>
                <span className="hib-active-run-text">
                  {topRun?.ticker || "Ticker"} {typeof topRun?.llm_progress_pct === "number" ? `${topPct.toFixed(1)}%` : ""}
                </span>
                {activeRuns.length > 1 ? <span className="hib-active-run-text">(+{activeRuns.length - 1} more)</span> : null}
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="hib-active-run-text text-[11px] tracking-[0.08em]">{topStep}</span>
                <div className="flex items-center gap-2">
                  {topRun ? (
                    <button
                      type="button"
                      disabled={topRunStopping}
                      onClick={async () => {
                        const ok = window.confirm(`Stop analysis for ${topRun.ticker}?`);
                        if (!ok) return;
                        setStoppingJobId(topRun.job_id);
                        try {
                          const res = await cancelActiveRun(topRun.job_id);
                          if (!res.ok) {
                            window.alert(res.error || "Failed to stop run.");
                          }
                        } finally {
                          setStoppingJobId("");
                        }
                      }}
                      className="rounded border border-red-400/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-red-100 hover:bg-red-500/20 disabled:opacity-60"
                    >
                      {topRunStopping ? "Stopping..." : "Stop"}
                    </button>
                  ) : null}
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-300 transition-all duration-500" style={{ width: `${topPct}%` }} />
                  </div>
                </div>
              </div>
            </div>
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
                  <span className="font-medium">
                    {toast.message}: {toast.ticker}
                  </span>
                </div>
                <Link
                  href={`/dashboard/${encodeURIComponent(toast.ticker)}/summary`}
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
