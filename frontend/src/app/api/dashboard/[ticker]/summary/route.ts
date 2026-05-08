import { NextResponse } from "next/server";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { getLiveCurrentPricesBatch } from "@/lib/dashboard-server";
import {
  computeTickerSummaryAggregation,
  type SummarySourceReport,
  type SummaryWindow,
} from "@/lib/ticker-summary-aggregate";
import { listDashboardsForTicker } from "@/lib/reports-db";
import { listDashboardReports, readJson } from "@/lib/server-outputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const WINDOW_VALUES = new Set<SummaryWindow>(["all", "1y", "3m", "1m", "1w"]);

function parseWindow(value: string | null): SummaryWindow {
  const raw = String(value || "").trim().toLowerCase();
  return WINDOW_VALUES.has(raw as SummaryWindow) ? (raw as SummaryWindow) : "all";
}

function siteRunIdFromPathLike(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, "/");
  const match = normalized.match(/\/_site_runs\/([^/]+)/i);
  return match?.[1] ? String(match[1]).trim() : null;
}

async function loadTickerDashboards(ticker: string): Promise<SummarySourceReport[]> {
  const merged = new Map<string, SummarySourceReport>();

  try {
    const dbRows = await listDashboardsForTicker(ticker);
    for (const r of dbRows) {
      const row = {
        ticker: String(r.ticker || "").toUpperCase(),
        generatedAt: new Date(r.generated_at).toISOString(),
        payload: r.dashboard as DashboardPayload,
      };
      if (row.ticker !== ticker || !row.payload) continue;
      const runId = String((r as { source_run_id?: unknown }).source_run_id || "").trim();
      const key = runId ? `run:${row.ticker}:${runId}` : `db:${row.ticker}:${row.generatedAt}`;
      merged.set(key, row);
    }
  } catch (err) {
    console.warn("[ticker-summary] DB read failed:", err);
  }

  for (const entry of listDashboardReports()) {
    if (String(entry.ticker || "").toUpperCase() !== ticker) continue;
    const payload = readJson<DashboardPayload>(entry.path);
    if (!payload) continue;
    const generatedAt =
      typeof payload.generated_at === "string" && payload.generated_at.trim()
        ? payload.generated_at
        : new Date(entry.mtimeMs).toISOString();
    const row: SummarySourceReport = { ticker, generatedAt, payload };
    const runId = siteRunIdFromPathLike(entry.path);
    const key = runId ? `run:${ticker}:${runId}` : `file:${entry.path}`;
    if (merged.has(key)) continue;
    merged.set(key, row);
  }

  return Array.from(merged.values()).sort(
    (a, b) => Date.parse(String(b.generatedAt || "")) - Date.parse(String(a.generatedAt || "")),
  );
}

export async function GET(
  req: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  const tk = String(ticker || "").trim().toUpperCase();
  if (!tk) {
    return NextResponse.json({ error: "Ticker is required." }, { status: 400 });
  }

  const url = new URL(req.url);
  const window = parseWindow(url.searchParams.get("window"));
  const reports = await loadTickerDashboards(tk);
  const aggregation = computeTickerSummaryAggregation(reports, window);
  const livePriceMap = await getLiveCurrentPricesBatch([tk]);
  const liveCurrentPrice = typeof livePriceMap[tk] === "number" ? Number(livePriceMap[tk]) : null;

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    ticker: tk,
    window,
    coverage: aggregation.coverage,
    overview: {
      ...aggregation.overview,
      live_current_price: liveCurrentPrice,
    },
    by_model: aggregation.by_model,
    by_valuator: aggregation.by_valuator,
    assumptions: aggregation.assumptions,
  });
}
