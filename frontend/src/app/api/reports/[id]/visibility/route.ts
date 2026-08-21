import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getSql } from "@/lib/db";
import { setReportVisibility, type ReportVisibility } from "@/lib/reports-db";
import { parseApiWorkspace } from "@/lib/workspace";

const VALID = new Set<ReportVisibility>(["public", "private", "unlisted"]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  const viewerId = session?.user?.id || null;
  const workspace = parseApiWorkspace(new URL(req.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const rows = (await sql`
    SELECT reports.id::text AS id,
           reports.user_id::text AS user_id,
           reports.visibility
      FROM reports
      LEFT JOIN report_releases rel ON rel.id = reports.release_id
     WHERE reports.id = ${id}::uuid
       AND reports.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status = 'active')
       AND reports.deleted_at IS NULL
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
  const workspace = parseApiWorkspace(new URL(req.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
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
    workspace,
  });
  if (!updated) {
    return NextResponse.json({ error: "forbidden_or_missing" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, visibility: next });
}
