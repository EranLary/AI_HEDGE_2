"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReportListItem } from "@/lib/dashboard-types";

export function DashboardSkeleton({ message }: { message?: string }) {
  return (
    <div>
      <div className="mb-3 text-xs uppercase tracking-[0.14em] text-zinc-500">{message || "Loading dashboard..."}</div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/5" />
        ))}
      </div>
    </div>
  );
}

export function ReportChipRow({
  ticker,
  reports,
  currentReportId,
}: {
  ticker: string;
  reports: ReportListItem[];
  currentReportId: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  if (reports.length <= 1) return null;

  return (
    <section className="mb-4 rounded-xl border border-white/10 bg-zinc-950/70 p-3">
      <p className="mb-2 text-xs uppercase tracking-[0.14em] text-zinc-400">
        Report Versions ({ticker}) — Newest to Oldest
      </p>
      <div className="flex flex-wrap gap-2">
        {reports.map((report) => {
          const active = report.report_id === currentReportId;
          const nextParams = new URLSearchParams(params?.toString() || "");
          nextParams.set("report", report.report_id);
          return (
            <button
              key={report.report_id}
              type="button"
              onClick={() => {
                router.replace(`?${nextParams.toString()}`, { scroll: false });
              }}
              className={`rounded-lg border px-3 py-2 text-xs transition ${
                active
                  ? "hib-tab-active border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                  : "hib-tab-inactive border-white/15 bg-white/5 text-zinc-300"
              }`}
            >
              {new Date(report.generated_at || report.updated_at).toLocaleString()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardError({ error, ticker }: { error: string; ticker: string }) {
  return (
    <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-100">
      <p className="font-semibold">{error}</p>
      <p className="mt-1 text-xs">No data for {ticker}.</p>
      <Link href="/dashboard" className="mt-3 inline-block rounded border border-white/30 px-2 py-1 text-xs">
        Back to dashboards
      </Link>
    </div>
  );
}
