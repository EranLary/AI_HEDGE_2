"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReportListItem } from "@/lib/dashboard-types";

function fmtDateTimeNoSeconds(value: string): string {
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "N/A";
  return dt.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function DashboardIndexPage() {
  return (
    <Suspense fallback={<DashboardIndexFallback />}>
      <DashboardIndexInner />
    </Suspense>
  );
}

function DashboardIndexFallback() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 text-center text-sm text-zinc-400">Loading dashboards...</div>
  );
}

function DashboardIndexInner() {
  const router = useRouter();
  const search = useSearchParams();
  const legacyTicker = search?.get("ticker");
  const legacyReport = search?.get("report");

  const [reports, setReports] = useState<ReportListItem[]>([]);

  useEffect(() => {
    if (!legacyTicker) return;
    const suffix = legacyReport ? `?report=${encodeURIComponent(legacyReport)}` : "";
    router.replace(`/dashboard/${encodeURIComponent(legacyTicker.toUpperCase())}/overview${suffix}`);
  }, [legacyTicker, legacyReport, router]);

  useEffect(() => {
    if (legacyTicker) return;
    let cancelled = false;
    fetch("/api/reports", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const rows = Array.isArray(json?.reports) ? (json.reports as ReportListItem[]) : [];
        rows.sort(
          (a, b) =>
            Date.parse(b.generated_at || b.updated_at || "") - Date.parse(a.generated_at || a.updated_at || ""),
        );
        setReports(rows);
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [legacyTicker]);

  if (legacyTicker) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <p className="text-sm text-zinc-400">Redirecting to {legacyTicker.toUpperCase()}...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-zinc-100">Dashboards</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">
          Pick a ticker from the sidebar or open a recent report.
        </p>
      </header>

      <p className="mb-3 text-xs uppercase tracking-[0.14em] text-zinc-400">Recent Reports</p>
      <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-2">
        {reports.length ? (
          <ul className="divide-y divide-white/5">
            {reports.slice(0, 40).map((r) => (
              <li key={r.report_id}>
                <Link
                  href={`/dashboard/${encodeURIComponent(r.ticker)}/overview?report=${encodeURIComponent(r.report_id)}`}
                  className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-emerald-500/5"
                >
                  <span className="font-semibold text-zinc-100">{r.ticker}</span>
                  <span className="text-xs text-zinc-400">
                    {fmtDateTimeNoSeconds(String(r.generated_at || r.updated_at || ""))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-sm text-zinc-500">
            No reports yet. Run your first analysis from{" "}
            <Link href="/" className="underline hover:text-zinc-200">
              Home
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
