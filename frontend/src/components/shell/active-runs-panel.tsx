"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cancelActiveRun, subscribeActiveRuns, getActiveRunsSnapshot } from "@/components/shell/active-runs-store";
import type { ClientActiveRun } from "@/lib/active-runs";

export function ActiveRunsPanel({ collapsed = false }: { collapsed?: boolean }) {
  const [runs, setRuns] = useState<ClientActiveRun[]>(() => getActiveRunsSnapshot());
  const [stoppingJobId, setStoppingJobId] = useState<string>("");

  useEffect(() => {
    return subscribeActiveRuns(setRuns);
  }, []);

  const active = runs.filter((r) => r.status === "queued" || r.status === "running");
  if (!active.length) return null;

  if (collapsed) {
    return (
      <div
        className="hib-sidebar-item flex h-10 w-10 items-center justify-center rounded-lg text-[11px]"
        title={`${active.length} active run${active.length > 1 ? "s" : ""}`}
      >
        <Loader2 size={14} className="animate-spin text-emerald-300" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/8 p-2">
      <p className="hib-sidebar-heading mb-1 px-1 text-[10px] uppercase tracking-[0.16em]">Active Runs</p>
      <ul className="space-y-1">
        {active.slice(0, 4).map((run) => {
          const pct = typeof run.llm_progress_pct === "number" ? Math.max(0, Math.min(100, run.llm_progress_pct)) : 0;
          const isStopping = stoppingJobId === run.job_id;
          return (
            <li key={run.job_id}>
              <div className="rounded-md px-2 py-1 text-xs text-emerald-50 hover:bg-emerald-500/12">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/dashboard/${encodeURIComponent(run.ticker)}/summary`}
                    className="font-semibold hover:underline"
                  >
                    {run.ticker}
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]">{pct.toFixed(0)}%</span>
                    <button
                      type="button"
                      disabled={isStopping}
                      onClick={async () => {
                        const ok = window.confirm(`Stop analysis for ${run.ticker}?`);
                        if (!ok) return;
                        setStoppingJobId(run.job_id);
                        try {
                          const res = await cancelActiveRun(run.job_id);
                          if (!res.ok) {
                            window.alert(res.error || "Failed to stop run.");
                          }
                        } finally {
                          setStoppingJobId("");
                        }
                      }}
                      className="rounded border border-red-400/50 px-1.5 py-0.5 text-[10px] font-semibold text-red-100 hover:bg-red-500/20 disabled:opacity-60"
                    >
                      {isStopping ? "..." : "Stop"}
                    </button>
                  </div>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-emerald-300 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </li>
          );
        })}
        {active.length > 4 ? (
          <li className="px-2 text-[10px] text-zinc-400">+{active.length - 4} more</li>
        ) : null}
      </ul>
    </div>
  );
}
