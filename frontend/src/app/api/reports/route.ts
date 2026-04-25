import { NextResponse } from "next/server";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { listAllReports } from "@/lib/reports-db";
import { listDashboardReports, readJson } from "@/lib/server-outputs";

export async function GET() {
  try {
    const dbRows = await listAllReports();
    if (dbRows.length) {
      const reports: ReportListItem[] = dbRows.map((r) => ({
        report_id: r.id,
        ticker: r.ticker,
        generated_at: new Date(r.generated_at).toISOString(),
        report_file: r.source_run_id || r.id,
        updated_at: new Date(r.generated_at).toISOString(),
      }));
      return NextResponse.json({ count: reports.length, reports });
    }
  } catch (err) {
    console.warn("[reports] DB read failed:", err);
  }

  const rows: ReportListItem[] = [];
  const reports = listDashboardReports();
  for (const report of reports) {
    const payload = readJson<DashboardPayload>(report.path);
    const generatedAt = String(payload?.generated_at || new Date(report.mtimeMs).toISOString());
    rows.push({
      report_id: report.report_id,
      ticker: report.ticker,
      generated_at: generatedAt,
      report_file: report.path,
      updated_at: new Date(report.mtimeMs).toISOString(),
    });
  }
  return NextResponse.json({
    count: rows.length,
    reports: rows,
  });
}
