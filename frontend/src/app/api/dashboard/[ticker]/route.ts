import { NextResponse } from "next/server";

import { getDashboardPayload } from "@/lib/dashboard-server";
import { parseApiWorkspace } from "@/lib/workspace";

export async function GET(
  req: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const params = await context.params;
  const ticker = String(params.ticker || "").toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required." }, { status: 400 });
  }
  const url = new URL(req.url);
  const requestedReportId = String(url.searchParams.get("report") || "").trim();
  const workspace = parseApiWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  const payload = await getDashboardPayload(ticker, requestedReportId, workspace);
  if (requestedReportId && !payload.report_id) {
    return NextResponse.json({ error: "Report not found in this workspace." }, { status: 404 });
  }
  return NextResponse.json(payload);
}
