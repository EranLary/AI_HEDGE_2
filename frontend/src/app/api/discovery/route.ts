import { NextResponse } from "next/server";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { getLiveCurrentPricesBatch } from "@/lib/dashboard-server";
import { isDbEnabled } from "@/lib/db";
import { getDeletedReportFilter, siteRunIdFromPathLike } from "@/lib/deleted-reports";
import {
  normalizeDiscoveryLensType,
  prepareDiscoveryUniverse,
  rankDiscoveryRows,
  resolveDiscoveryLens,
  scoreDiscoveryCandidates,
  type DiscoverySourceReport,
} from "@/lib/discovery-engine";
import { isExcludedTicker } from "@/lib/excluded-tickers";
import { listAllDashboardsForHitRate } from "@/lib/reports-db";
import { listDashboardReports, readJson } from "@/lib/server-outputs";
import { parseApiWorkspace, type Workspace } from "@/lib/workspace";

type LoadedDashboard = {
  ticker: string;
  payload: DashboardPayload;
  updatedAt: string;
  reportId?: string;
};

async function loadDashboards(workspace: Workspace): Promise<LoadedDashboard[]> {
  const merged = new Map<string, LoadedDashboard>();
  const deletedFilter = await getDeletedReportFilter(workspace);
  const dbEnabled = isDbEnabled();

  try {
    const dbRows = await listAllDashboardsForHitRate(workspace);
    for (const record of dbRows) {
      const ticker = String(record.ticker || "").trim().toUpperCase();
      if (!ticker || isExcludedTicker(ticker)) continue;
      const row: LoadedDashboard = {
        ticker,
        payload: record.dashboard as DashboardPayload,
        updatedAt: new Date(record.generated_at).toISOString(),
        reportId: String(record.id || "").trim() || undefined,
      };
      const runId = String(record.source_run_id || "").trim();
      const key = runId ? `run:${ticker}:${runId}` : `db:${ticker}:${row.updatedAt}`;
      merged.set(key, row);
    }
    if (dbEnabled) {
      return Array.from(merged.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
  } catch (error) {
    console.warn("[discovery] DB read failed:", error);
  }

  if (workspace === "nasdaq100") return [];

  for (const entry of listDashboardReports()) {
    const payload = readJson<DashboardPayload>(entry.path);
    if (!payload) continue;
    const ticker = String(payload.ticker || entry.ticker || "").trim().toUpperCase();
    if (!ticker || isExcludedTicker(ticker)) continue;
    const updatedAt =
      typeof payload.generated_at === "string" && payload.generated_at.trim()
        ? payload.generated_at
        : new Date(entry.mtimeMs).toISOString();
    const row: LoadedDashboard = { ticker, payload, updatedAt, reportId: entry.report_id || undefined };
    const runId = siteRunIdFromPathLike(entry.path);
    const key = runId ? `run:${ticker}:${runId}` : `file:${entry.path}`;
    if (deletedFilter.isDeleted(entry.report_id, ticker, runId) || merged.has(key)) continue;
    merged.set(key, row);
  }

  return Array.from(merged.values()).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedType = normalizeDiscoveryLensType(url.searchParams.get("lens_type"));
  const workspace = parseApiWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  const requestedKey = String(url.searchParams.get("lens_key") || "").trim() || null;
  const asOfMs = Date.now();
  const items = await loadDashboards(workspace);
  const reports: DiscoverySourceReport[] = items.map((item) => ({
    ticker: item.ticker,
    generatedAt: item.updatedAt,
    payload: item.payload,
    reportId: item.reportId,
  }));
  const tickers = Array.from(new Set(reports.map((report) => report.ticker)));
  const livePrices = await getLiveCurrentPricesBatch(tickers);
  const priceByTicker = new Map<string, number | null>(
    tickers.map((ticker) => {
      const price = Number(livePrices[ticker]);
      return [ticker, Number.isFinite(price) ? price : null];
    }),
  );
  const universe = prepareDiscoveryUniverse({ reports, priceByTicker, asOfMs });
  const lens = resolveDiscoveryLens(requestedType, requestedKey, universe.models, universe.valuators);
  const ranked = rankDiscoveryRows(scoreDiscoveryCandidates(universe, lens));

  return NextResponse.json({
    generated_at: new Date(asOfMs).toISOString(),
    workspace,
    lens,
    lens_options: { models: universe.models, valuators: universe.valuators },
    window: "3m",
    window_hours: 24 * 90,
    count: ranked.all.length,
    top_undervalued: ranked.topUndervalued,
    top_overvalued: ranked.topOvervalued,
    top_conviction: ranked.topConviction,
    top_highest_allocation: ranked.topHighestAllocation,
    top_lowest_allocation: ranked.topLowestAllocation,
    top_scores: ranked.topScores,
    lowest_scores: ranked.lowestScores,
    top_gems: ranked.topUndervalued,
    bubbles: ranked.topOvervalued,
    high_conviction: ranked.topConviction,
  });
}
