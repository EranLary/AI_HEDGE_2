"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import type { ReportListItem } from "@/lib/dashboard-types";
import { useNewRunModal } from "@/components/shell/new-run-context";
import { useWorkspace } from "@/components/shell/workspace-context";

export function RecentReportsGrid({ reports }: { reports: ReportListItem[] }) {
  const { open } = useNewRunModal();
  const { workspace, href } = useWorkspace();
  const recent = reports.slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-zinc-100">Your reports</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">
            {reports.length} total · last {Math.min(recent.length, reports.length)} shown
          </p>
        </div>
        {workspace === "analysis" ? <button
          type="button"
          onClick={open}
          className="hib-run-btn inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-500/30"
        >
          <Plus size={14} />
          New Run
        </button> : null}
      </header>

      <ul className="grid gap-2 sm:grid-cols-2">
        {recent.map((r) => (
          <li key={r.report_id}>
            <Link
              href={`${href(`/dashboard/${encodeURIComponent(r.ticker)}/summary`)}?report=${encodeURIComponent(r.report_id)}`}
              className="block rounded-xl border border-white/10 bg-zinc-950/70 px-4 py-3 transition hover:border-emerald-400/50 hover:bg-emerald-500/5"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-lg text-zinc-100">{r.ticker}</span>
                <span className="text-xs text-zinc-400">
                  {new Date(r.generated_at || r.updated_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {reports.length > recent.length ? (
        <div className="mt-4 text-center">
          <Link
            href={href("/reports")}
            className="text-xs uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-100"
          >
            See all {reports.length} reports →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
