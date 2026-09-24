import { NextResponse } from "next/server";

import { getJevMetrics } from "@/lib/jev-db";
import type { JevForecastMode } from "@/lib/jev-metrics";
import { parseApiWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseMode(value: string | null): JevForecastMode {
  return String(value || "").trim().toLowerCase() === "forward" ? "forward" : "retrospective";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspace = parseApiWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  const mode = parseMode(url.searchParams.get("mode"));
  try {
    const metrics = await getJevMetrics(workspace, mode);
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      workspace,
      ...metrics,
    });
  } catch (error) {
    console.warn("[jev-track-record] DB read failed:", error);
    return NextResponse.json({ error: "Failed to load Jev track record." }, { status: 500 });
  }
}
