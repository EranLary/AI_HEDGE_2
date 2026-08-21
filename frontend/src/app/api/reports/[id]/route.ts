import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { deleteUserReport, fetchReportById } from "@/lib/reports-db";
import { parseApiWorkspace } from "@/lib/workspace";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reportId = String(id || "").trim();
  const workspace = parseApiWorkspace(new URL(req.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  if (!reportId) {
    return NextResponse.json({ error: "missing_report_id" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!(await fetchReportById(reportId, workspace))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const deleted = await deleteUserReport({ reportId, userId, workspace });
  if (!deleted) {
    return NextResponse.json({ error: "forbidden_or_missing" }, { status: 403 });
  }

  revalidateTag("reports", "max");
  return NextResponse.json({ ok: true });
}
