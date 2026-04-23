import { NextResponse } from "next/server";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { listDashboardReports, readJson } from "@/lib/server-outputs";

export async function GET() {
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

