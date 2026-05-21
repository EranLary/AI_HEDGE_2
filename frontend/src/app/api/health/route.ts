import { NextResponse } from "next/server";

// Lightweight liveness probe. No auth, no DB, no rendering — cheap to hit.
// Used by the preview keep-alive self-ping in scripts/site_run.py to keep a
// Fly preview machine alive while an analysis run is in progress.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse("ok", {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}
