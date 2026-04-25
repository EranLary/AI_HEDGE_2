import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getSql } from "@/lib/db";
import { setReportVisibility, type ReportVisibility } from "@/lib/reports-db";

const VALID = new Set<ReportVisibility>(["public", "private", "unlisted"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const viewerId = session?.user?.id || null;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const rows = (await sql`
    SELECT id::text AS id,
           user_id::text AS user_id,
           visibility
      FROM reports
     WHERE id = ${id}::uuid
       AND deleted_at IS NULL
     LIMIT 1
  `) as Array<{ id: string; user_id: string | null; visibility: string }>;

  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    visibility: row.visibility,
    ownsThis: Boolean(viewerId && row.user_id === viewerId),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { visibility?: string } | null;
  const next = body?.visibility as ReportVisibility | undefined;
  if (!next || !VALID.has(next)) {
    return NextResponse.json({ error: "invalid_visibility" }, { status: 400 });
  }

  const updated = await setReportVisibility({
    reportId: id,
    userId,
    visibility: next,
  });
  if (!updated) {
    return NextResponse.json({ error: "forbidden_or_missing" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, visibility: next });
}
