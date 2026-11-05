import { NextResponse } from "next/server";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { normalizeValuationConsensus } from "@/lib/dashboard-normalize";
import { getHistoricalPricesBatch, getLiveCurrentPricesBatch } from "@/lib/dashboard-server";
import { isDbEnabled } from "@/lib/db";
import { getDeletedReportFilter, siteRunIdFromPathLike } from "@/lib/deleted-reports";
import { computeHitRateAggregation, type HitRateMode } from "@/lib/hit-rate-aggregate";
import { computeHorizonAccuracy } from "@/lib/hit-rate-horizons";
import { listAllDashboardsForHitRate } from "@/lib/reports-db";
import { listDashboardReports, readJson } from "@/lib/server-outputs";
import { parseApiWorkspace, type Workspace } from "@/lib/workspace";

type LoadedDashboard = {
  ticker: string;
  generatedAt: string;
  availableAt: string;
  payload: DashboardPayload;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadHistoricalDashboards(workspace: Workspace): Promise<LoadedDashboard[]> {
  const merged = new Map<string, LoadedDashboard>();
  const deletedFilter = await getDeletedReportFilter(workspace);
  const dbEnabled = isDbEnabled();

  try {
    const dbRows = await listAllDashboardsForHitRate(workspace);
    for (const r of dbRows) {
      const row = {
        ticker: String(r.ticker || "").toUpperCase(),
        generatedAt: new Date(r.generated_at).toISOString(),
        availableAt: new Date(r.available_at || r.generated_at).toISOString(),
        payload: normalizeValuationConsensus(r.dashboard as DashboardPayload),
      };
      if (!row.ticker || !row.payload) continue;
      const runId = String(r.source_run_id || "").trim();
      const key = runId ? `run:${row.ticker}:${runId}` : `db:${row.ticker}:${row.generatedAt}`;
      merged.set(key, row);
    }
    if (dbEnabled) {
      return Array.from(merged.values()).sort(
        (a, b) => Date.parse(String(b.generatedAt || "")) - Date.parse(String(a.generatedAt || "")),
      );
    }
  } catch (err) {
    console.warn("[hit-rate] DB read failed:", err);
  }

  if (workspace === "nasdaq100") return [];

  for (const entry of listDashboardReports()) {
    const payload = readJson<DashboardPayload>(entry.path);
    if (!payload) continue;
    if (payload.research_harness?.automation_eligible === false) continue;
    const ticker = String(payload.ticker || entry.ticker || "").toUpperCase();
    if (!ticker) continue;
    const generatedAt =
      typeof payload.generated_at === "string" && payload.generated_at.trim()
        ? payload.generated_at
        : new Date(entry.mtimeMs).toISOString();
    const row = { ticker, generatedAt, availableAt: generatedAt, payload: normalizeValuationConsensus(payload) };
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
  const workspace = parseApiWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  const reports = await loadHistoricalDashboards(workspace);
  const uniqueTickers = Array.from(new Set(reports.map((r) => r.ticker).filter(Boolean)));
  const evaluationDates = reports
    .map((report) => Date.parse(report.availableAt || report.generatedAt))
    .filter((value) => Number.isFinite(value));
  const earliest = evaluationDates.length ? Math.min(...evaluationDates) : Date.now();
  const historyStart = new Date(earliest - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const historyEnd = new Date().toISOString().slice(0, 10);
  const [livePrices, historicalPrices] = await Promise.all([
    getLiveCurrentPricesBatch(uniqueTickers),
    getHistoricalPricesBatch(uniqueTickers, historyStart, historyEnd),
  ]);
  const livePriceByTicker = new Map<string, number | null>(
    Object.entries(livePrices),
  );
  const historicalPricesByTicker = new Map(Object.entries(historicalPrices));
  const aggregation = computeHitRateAggregation(reports, livePriceByTicker, mode, historicalPricesByTicker);
  const horizonAccuracy = computeHorizonAccuracy(
    reports,
    historicalPricesByTicker,
    livePriceByTicker,
    mode,
  );

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    mode,
    workspace,
    coverage: aggregation.coverage,
    overview: aggregation.overview,
    by_model: aggregation.by_model,
    by_valuator: aggregation.by_valuator,
    by_signal: aggregation.by_signal,
    horizon_accuracy: horizonAccuracy,
  });
}
