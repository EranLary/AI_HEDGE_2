import { NextResponse } from "next/server";

import { getJevDiscoveryRankings } from "@/lib/jev-db";
import { JEV_HORIZON_ORDER, type JevHorizon } from "@/lib/jev-metrics";
import { parseApiWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseHorizon(value: string | null): JevHorizon | null | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return null;
  return JEV_HORIZON_ORDER.includes(normalized as JevHorizon)
    ? normalized as JevHorizon
    : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspace = parseApiWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  const horizon = parseHorizon(url.searchParams.get("horizon"));
  if (horizon === undefined) return NextResponse.json({ error: "Invalid horizon." }, { status: 400 });

  try {
    const rankings = await getJevDiscoveryRankings(workspace, horizon);
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      workspace,
      horizon: horizon || "all",
      ...rankings,
    });
  } catch (error) {
    console.warn("[jev-discovery] DB read failed:", error);
    return NextResponse.json({ error: "Failed to load Jev discovery rankings." }, { status: 500 });
  }
}
