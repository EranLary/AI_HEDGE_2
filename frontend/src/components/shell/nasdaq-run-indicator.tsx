"use client";

import { Loader2 } from "lucide-react";

import { useNasdaqRunModal } from "@/components/shell/nasdaq-run-context";

function safePct(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function NasdaqRunIndicator() {
  const { liveRun, open } = useNasdaqRunModal();
  if (!liveRun) return null;

  const leadingPct = safePct(liveRun.leadingProgressPct);
  const leadingLabel = liveRun.leadingTicker
    ? `${liveRun.leadingTicker} ${leadingPct.toFixed(1)}%`
    : "Waiting for the next report";

  return (
    <div className="px-3 pt-2 sm:px-6" role="status" aria-live="polite">
      <div className="hib-active-run-banner mx-auto flex max-w-[1500px] items-center rounded-xl border px-3 py-2 text-xs backdrop-blur-md">
        <div className="w-full">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-2 font-medium uppercase tracking-[0.12em]">
              <Loader2 size={14} className="animate-spin" />
              Nasdaq 100 run
            </span>
            <span className="hib-active-run-text font-semibold">
              {liveRun.completedCount} / {liveRun.requestedCount} reports complete
            </span>
            <span className="hib-active-run-text">
              {liveRun.activeCount} running now · up to {liveRun.concurrency} at once
            </span>
            <span className="hib-active-run-text">Most advanced: {leadingLabel}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-label={`Most advanced report: ${leadingLabel}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(leadingPct)}
            >
              <div
                className="h-full rounded-full bg-emerald-300 transition-all duration-500"
                style={{ width: `${leadingPct}%` }}
              />
            </div>
            <button
              type="button"
              onClick={open}
              className="rounded border border-[color:var(--border-strong)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--text-primary)] transition hover:border-[color:var(--accent)]"
            >
              Details
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
