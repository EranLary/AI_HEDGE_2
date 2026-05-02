"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { subscribeActiveRuns, getActiveRunsSnapshot } from "@/components/shell/active-runs-store";
import type { ClientActiveRun } from "@/lib/active-runs";

export function ActiveRunsPanel({ collapsed = false }: { collapsed?: boolean }) {
  const [runs, setRuns] = useState<ClientActiveRun[]>(() => getActiveRunsSnapshot());

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
          return (
            <li key={run.job_id}>
              <Link
                href={`/dashboard/${encodeURIComponent(run.ticker)}/summary`}
                className="block rounded-md px-2 py-1 text-xs text-emerald-50 hover:bg-emerald-500/12"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{run.ticker}</span>
                  <span className="text-[10px]">{pct.toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-emerald-300 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </Link>
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
