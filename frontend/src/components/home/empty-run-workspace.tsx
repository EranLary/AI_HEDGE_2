"use client";

import { Plus, Sparkles } from "lucide-react";
import { useNewRunModal } from "@/components/shell/new-run-context";

export function EmptyRunWorkspace() {
  const { open } = useNewRunModal();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-16 text-center sm:py-24">
      <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-500/15 text-emerald-200">
        <Sparkles size={20} />
      </span>
      <h1 className="font-display text-3xl text-zinc-100 sm:text-4xl">Run your first analysis</h1>
      <p className="mt-2 max-w-md text-sm text-zinc-300">
        Pick any US ticker. Full institutional valuation in about 30 minutes — models, scenarios, dream-team personas, and a decision.
      </p>
      <button
        type="button"
        onClick={open}
        className="hib-run-btn mt-6 inline-flex items-center gap-2 rounded-xl border border-emerald-400/60 bg-emerald-500/20 px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-500/30"
      >
        <Plus size={16} />
        Start
      </button>
    </div>
  );
}
