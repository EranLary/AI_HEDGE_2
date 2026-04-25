import { NextResponse } from "next/server";

import { getReportsList } from "@/lib/dashboard-server";

export async function GET() {
  const reports = await getReportsList();
  return NextResponse.json({ count: reports.length, reports });
}
