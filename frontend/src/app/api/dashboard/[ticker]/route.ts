import { NextResponse } from "next/server";

import { getDashboardPayload } from "@/lib/dashboard-server";

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
  return NextResponse.json(await getDashboardPayload(ticker, requestedReportId));
}
