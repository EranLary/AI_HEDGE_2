import { NextResponse } from "next/server";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { getLiveCurrentPricesBatch, getLiveFundamentals } from "@/lib/dashboard-server";
import { isDbEnabled } from "@/lib/db";
import { getDeletedReportFilterForTicker, siteRunIdFromPathLike } from "@/lib/deleted-reports";
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

const ASSUMPTION_CURRENT_KEYS: Record<string, string> = {
  "representative fcf": "representative_fcf",
  "representative revenue": "representative_revenue",
  "representative ev sales": "representative_ev_sales",
  "representative earnings": "representative_earnings",
  "representative p e": "representative_pe",
};

function parseWindow(value: string | null): SummaryWindow {
  const raw = String(value || "").trim().toLowerCase();
  return WINDOW_VALUES.has(raw as SummaryWindow) ? (raw as SummaryWindow) : "all";
}

function normalizeAssumptionLabel(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[_/]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function loadTickerDashboards(ticker: string): Promise<SummarySourceReport[]> {
  const merged = new Map<string, SummarySourceReport>();
  const deletedFilter = await getDeletedReportFilterForTicker(ticker);
  const dbEnabled = isDbEnabled();

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
    if (dbEnabled) {
      return Array.from(merged.values()).sort(
        (a, b) => Date.parse(String(b.generatedAt || "")) - Date.parse(String(a.generatedAt || "")),
      );
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
    if (deletedFilter.isDeleted(entry.report_id, ticker, runId)) continue;
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
  const [livePriceMap, liveFundamentals] = await Promise.all([
    getLiveCurrentPricesBatch([tk]),
    getLiveFundamentals(tk),
  ]);
  const liveCurrentPrice = typeof livePriceMap[tk] === "number" ? Number(livePriceMap[tk]) : null;
  const currentAssumptions = liveFundamentals.assumption_current_values || {};
  const assumptions = aggregation.assumptions.map((row) => {
    const currentKey = ASSUMPTION_CURRENT_KEYS[normalizeAssumptionLabel(row.label)];
    return {
      ...row,
      current_value: currentKey ? safeNumber(currentAssumptions[currentKey]) : null,
    };
  });

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    ticker: tk,
    window,
    currency_context: {
      financial_currency: String(liveFundamentals.financial_currency || "USD").toUpperCase(),
    },
    coverage: aggregation.coverage,
    overview: {
      ...aggregation.overview,
      live_current_price: liveCurrentPrice,
    },
    by_model: aggregation.by_model,
    by_valuator: aggregation.by_valuator,
    assumptions,
  });
}
