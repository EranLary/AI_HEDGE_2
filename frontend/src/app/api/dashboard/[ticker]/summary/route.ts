import { NextResponse } from "next/server";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { getLiveCurrentPricesBatch } from "@/lib/dashboard-server";
import {
  computeTickerSummaryAggregation,
  type SummarySourceReport,
  type SummaryWindow,
} from "@/lib/ticker-summary-aggregate";
import { listDashboardsForTicker } from "@/lib/reports-db";
import { listDashboardFiles, readJson } from "@/lib/server-outputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const WINDOW_VALUES = new Set<SummaryWindow>(["all", "1y", "3m", "1m", "1w"]);

function parseWindow(value: string | null): SummaryWindow {
  const raw = String(value || "").trim().toLowerCase();
  return WINDOW_VALUES.has(raw as SummaryWindow) ? (raw as SummaryWindow) : "all";
}

async function loadTickerDashboards(ticker: string): Promise<SummarySourceReport[]> {
  try {
    const dbRows = await listDashboardsForTicker(ticker);
    if (dbRows.length) {
      return dbRows
        .map((r) => ({
          ticker: String(r.ticker || "").toUpperCase(),
          generatedAt: new Date(r.generated_at).toISOString(),
          payload: r.dashboard as DashboardPayload,
        }))
        .filter((row) => row.ticker === ticker && Boolean(row.payload));
    }
  } catch (err) {
    console.warn("[ticker-summary] DB read failed:", err);
  }

  return listDashboardFiles()
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((item) => {
      const payload = readJson<DashboardPayload>(item.path);
      if (!payload) return null;
      const payloadTicker = String(payload.ticker || "").toUpperCase();
      if (payloadTicker !== ticker) return null;
      return {
        ticker,
        generatedAt: new Date(item.mtimeMs).toISOString(),
        payload,
      } satisfies SummarySourceReport;
    })
    .filter((row): row is SummarySourceReport => row !== null);
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
