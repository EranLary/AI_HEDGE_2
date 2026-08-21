import { NextResponse } from "next/server";

import { getReportsList } from "@/lib/dashboard-server";
import { parseApiWorkspace } from "@/lib/workspace";

export async function GET(request: Request) {
  const workspace = parseApiWorkspace(new URL(request.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  const reports = await getReportsList(workspace);
  return NextResponse.json({ count: reports.length, reports });
}
