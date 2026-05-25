import { NextResponse } from "next/server";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { getLiveCurrentPricesBatch } from "@/lib/dashboard-server";
import { getDeletedReportFilter, siteRunIdFromPathLike } from "@/lib/deleted-reports";
import { computeHitRateAggregation, type HitRateMode } from "@/lib/hit-rate-aggregate";
import { listAllDashboardsForHitRate } from "@/lib/reports-db";
import { listDashboardReports, readJson } from "@/lib/server-outputs";

type LoadedDashboard = {
  ticker: string;
  generatedAt: string;
  payload: DashboardPayload;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadHistoricalDashboards(): Promise<LoadedDashboard[]> {
  const merged = new Map<string, LoadedDashboard>();
  const deletedFilter = await getDeletedReportFilter();

  try {
    const dbRows = await listAllDashboardsForHitRate();
    for (const r of dbRows) {
      const row = {
        ticker: String(r.ticker || "").toUpperCase(),
        generatedAt: new Date(r.generated_at).toISOString(),
        payload: r.dashboard as DashboardPayload,
      };
      if (!row.ticker || !row.payload) continue;
      const runId = String(r.source_run_id || "").trim();
      const key = runId ? `run:${row.ticker}:${runId}` : `db:${row.ticker}:${row.generatedAt}`;
      merged.set(key, row);
    }
  } catch (err) {
    console.warn("[hit-rate] DB read failed:", err);
  }

  for (const entry of listDashboardReports()) {
    const payload = readJson<DashboardPayload>(entry.path);
    if (!payload) continue;
    const ticker = String(payload.ticker || entry.ticker || "").toUpperCase();
    if (!ticker) continue;
    const generatedAt =
      typeof payload.generated_at === "string" && payload.generated_at.trim()
        ? payload.generated_at
        : new Date(entry.mtimeMs).toISOString();
    const row = { ticker, generatedAt, payload };
    const runId = siteRunIdFromPathLike(entry.path);
    const key = runId ? `run:${ticker}:${runId}` : `file:${entry.path}`;
    if (deletedFilter.isDeleted(entry.report_id, ticker, runId)) continue;
    if (merged.has(key)) continue;
    merged.set(key, row);
  }

  return Array.from(merged.values()).sort(
    (a, b) => Date.parse(String(b.generatedAt || "")) - Date.parse(String(a.generatedAt || "")),
  );
}

function parseMode(value: string | null): HitRateMode {
  return String(value || "").trim().toLowerCase() === "positive_only" ? "positive_only" : "all";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = parseMode(url.searchParams.get("mode"));
  const reports = await loadHistoricalDashboards();
  const uniqueTickers = Array.from(new Set(reports.map((r) => r.ticker).filter(Boolean)));
  const livePriceByTicker = new Map<string, number | null>(
    Object.entries(await getLiveCurrentPricesBatch(uniqueTickers)),
  );
  const aggregation = computeHitRateAggregation(reports, livePriceByTicker, mode);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    mode,
    coverage: aggregation.coverage,
    overview: aggregation.overview,
    by_model: aggregation.by_model,
    by_valuator: aggregation.by_valuator,
  });
}
