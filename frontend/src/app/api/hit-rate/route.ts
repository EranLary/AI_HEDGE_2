import { NextResponse } from "next/server";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { getLiveCurrentPricesBatch } from "@/lib/dashboard-server";
import { computeHitRateAggregation } from "@/lib/hit-rate-aggregate";
import { listAllDashboardsForHitRate } from "@/lib/reports-db";
import { listDashboardFiles, readJson } from "@/lib/server-outputs";

type LoadedDashboard = {
  ticker: string;
  generatedAt: string;
  payload: DashboardPayload;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadHistoricalDashboards(): Promise<LoadedDashboard[]> {
  try {
    const dbRows = await listAllDashboardsForHitRate();
    if (dbRows.length) {
      return dbRows
        .map((r) => ({
          ticker: String(r.ticker || "").toUpperCase(),
          generatedAt: new Date(r.generated_at).toISOString(),
          payload: r.dashboard as DashboardPayload,
        }))
        .filter((row) => Boolean(row.ticker && row.payload));
    }
  } catch (err) {
    console.warn("[hit-rate] DB read failed:", err);
  }

  const files = listDashboardFiles().sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files
    .map((item) => {
      const payload = readJson<DashboardPayload>(item.path);
      if (!payload) return null;
      const ticker = String(payload.ticker || "").toUpperCase();
      if (!ticker) return null;
      return {
        ticker,
        generatedAt: new Date(item.mtimeMs).toISOString(),
        payload,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export async function GET() {
  const reports = await loadHistoricalDashboards();
  const uniqueTickers = Array.from(new Set(reports.map((r) => r.ticker).filter(Boolean)));
  const livePriceByTicker = new Map<string, number | null>(
    Object.entries(await getLiveCurrentPricesBatch(uniqueTickers)),
  );
  const aggregation = computeHitRateAggregation(reports, livePriceByTicker);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    coverage: aggregation.coverage,
    overview: aggregation.overview,
    by_model: aggregation.by_model,
    by_valuator: aggregation.by_valuator,
  });
}
