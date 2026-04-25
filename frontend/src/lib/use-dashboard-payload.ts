"use client";

import { useEffect, useState } from "react";
import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";

function reportTimestamp(report: ReportListItem): number {
  const raw = String(report.generated_at || report.updated_at || "");
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export type DashboardPayloadState = {
  data: DashboardPayload | null;
  loading: boolean;
  error: string;
  reports: ReportListItem[];
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

/** Fetch the dashboard payload for a given ticker (and optional report). Adds
 *  report list awareness so callers can surface a version-switcher. */
export function useDashboardPayload(ticker: string, reportId?: string): DashboardPayloadState {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const upperTicker = String(ticker || "").toUpperCase();

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
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reportsForTicker = reports
    .filter((r) => String(r.ticker || "").toUpperCase() === upperTicker)
    .sort((a, b) => reportTimestamp(b) - reportTimestamp(a));

  const explicit = reportId && reportsForTicker.find((r) => r.report_id === reportId);
  const resolvedReportId = explicit ? explicit.report_id : reportsForTicker[0]?.report_id || "";

  useEffect(() => {
    if (!upperTicker) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const url = resolvedReportId
      ? `/api/dashboard/${encodeURIComponent(upperTicker)}?report=${encodeURIComponent(resolvedReportId)}`
      : `/api/dashboard/${encodeURIComponent(upperTicker)}`;
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: DashboardPayload) => {
        if (cancelled) return;
        setData(j);
        setError("");
      })
      .catch(() => {
        if (!cancelled) setError(`Failed to load dashboard for ${upperTicker}.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [upperTicker, resolvedReportId]);

  return {
    data,
    loading,
    error,
    reports,
    reportsForTicker,
    resolvedReportId,
  };
}
