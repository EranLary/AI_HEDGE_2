import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { deleteUserReport } from "@/lib/reports-db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reportId = String(id || "").trim();
  if (!reportId) {
    return NextResponse.json({ error: "missing_report_id" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await deleteUserReport({ reportId, userId });
  if (!deleted) {
    return NextResponse.json({ error: "forbidden_or_missing" }, { status: 403 });
  }

  revalidateTag("reports", "max");
  return NextResponse.json({ ok: true });
}
