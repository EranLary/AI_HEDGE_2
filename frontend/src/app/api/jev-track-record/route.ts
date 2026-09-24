import { NextResponse } from "next/server";

import { getJevMetrics } from "@/lib/jev-db";
import type { JevForecastMode, JevPredictionScope } from "@/lib/jev-metrics";
import { parseApiWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseMode(value: string | null): JevForecastMode {
  return String(value || "").trim().toLowerCase() === "forward" ? "forward" : "retrospective";
}

function parseScope(value: string | null): JevPredictionScope {
  return String(value || "").trim().toLowerCase() === "all" ? "all" : "positive_only";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspace = parseApiWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  const mode = parseMode(url.searchParams.get("mode"));
  const scope = parseScope(url.searchParams.get("scope"));
  try {
    const metrics = await getJevMetrics(workspace, mode, scope);
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
