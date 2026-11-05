import { NextResponse } from "next/server";

import { fetchReportById } from "@/lib/reports-db";
import { fetchResearchAudit } from "@/lib/research-audit-db";
import { parseApiWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reportId = String(id || "").trim();
  const workspace = parseApiWorkspace(new URL(req.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  if (!reportId || !isUuid(reportId)) return NextResponse.json({ error: "invalid_report_id" }, { status: 400 });
  if (!(await fetchReportById(reportId, workspace))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const audit = await fetchResearchAudit(reportId);
  if (!audit) return NextResponse.json({ error: "audit_not_available" }, { status: 404 });
  return NextResponse.json(audit);
}
