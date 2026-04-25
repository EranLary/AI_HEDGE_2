"use client";

import { useEffect, useState } from "react";
import type { ReportListItem } from "@/lib/dashboard-types";
import { EmptyRunWorkspace } from "@/components/home/empty-run-workspace";
import { RecentReportsGrid } from "@/components/home/recent-reports-grid";

function reportTimestamp(report: ReportListItem): number {
  const ms = Date.parse(String(report.generated_at || report.updated_at || ""));
  return Number.isFinite(ms) ? ms : 0;
}

export default function Home() {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reports", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const rows = Array.isArray(json?.reports) ? (json.reports as ReportListItem[]) : [];
        rows.sort((a, b) => reportTimestamp(b) - reportTimestamp(a));
        setReports(rows);
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-white/10 bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (!reports.length) {
    return <EmptyRunWorkspace />;
  }

  return <RecentReportsGrid reports={reports} />;
}
