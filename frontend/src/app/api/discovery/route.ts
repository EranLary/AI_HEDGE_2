import path from "node:path";

import { NextResponse } from "next/server";

import { DashboardPayload, DiscoveryRow } from "@/lib/dashboard-types";
import { getLiveCurrentPricesBatch } from "@/lib/dashboard-server";
import { listAllDashboardsForHitRate } from "@/lib/reports-db";
import { listDashboardFiles, readJson } from "@/lib/server-outputs";
import {
  computeTickerSummaryAggregation,
  filterReportsByWindow,
  type SummarySourceReport,
} from "@/lib/ticker-summary-aggregate";

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeNumOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avgNums(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function combinedDecisionScore(investmentPct?: number | null, targetReturnPct?: number | null): number | null {
  const hasInvestment = typeof investmentPct === "number" && Number.isFinite(investmentPct);
  const hasTarget = typeof targetReturnPct === "number" && Number.isFinite(targetReturnPct);
  if (!hasInvestment && !hasTarget) return null;
  if (hasInvestment && hasTarget) return (0.5 * Number(investmentPct)) + (0.5 * Number(targetReturnPct));
  return hasInvestment ? Number(investmentPct) : Number(targetReturnPct);
}

function confidenceAdjustedScore(baseScore?: number | null, overallCv?: number | null): number | null {
  if (typeof baseScore !== "number" || !Number.isFinite(baseScore)) return null;
  const cv = typeof overallCv === "number" && Number.isFinite(overallCv) ? Math.max(0, overallCv) : 0;
  const confidenceFactor = 1 / (1 + Math.pow(cv, 1.3));
  return baseScore * confidenceFactor;
}

function decisionFromAdjustedScore(adjustedScore: number): {
  label: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
  tone: "buy" | "sell" | "hold";
} {
  if (adjustedScore >= 15) return { label: "Strong Buy", tone: "buy" };
  if (adjustedScore >= 7) return { label: "Buy", tone: "buy" };
  if (adjustedScore > -7) return { label: "Hold", tone: "hold" };
  if (adjustedScore > -15) return { label: "Sell", tone: "sell" };
  return { label: "Strong Sell", tone: "sell" };
}

function reportMs(value: string): number {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function meanCurrentPriceInWindow(reports: SummarySourceReport[]): number | null {
  const values = reports
    .map((report) => safeNumOrNull(report.payload.valuation_hub?.consensus?.current_price))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  return avgNums(values);
}

async function loadDashboards(): Promise<
  Array<{ ticker: string; payload: DashboardPayload; updatedAt: string; sourceLabel: string }>
> {
  try {
    const dbRows = await listAllDashboardsForHitRate();
    if (dbRows.length) {
      return dbRows.map((r) => ({
        ticker: String(r.ticker).toUpperCase(),
        payload: r.dashboard as DashboardPayload,
        updatedAt: new Date(r.generated_at).toISOString(),
        sourceLabel: r.ticker,
      }));
    }
  } catch (err) {
    console.warn("[discovery] DB read failed:", err);
  }
  const files = listDashboardFiles().sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files
    .map((item) => {
      const payload = readJson<DashboardPayload>(item.path);
      if (!payload) return null;
      return {
        ticker: String(payload.ticker || "").toUpperCase(),
        payload,
        updatedAt: new Date(item.mtimeMs).toISOString(),
        sourceLabel: item.path,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export async function GET() {
  const items = await loadDashboards();

  const rows: DiscoveryRow[] = [];
  const byTicker = new Map<string, SummarySourceReport[]>();
  for (const item of items) {
    const ticker = String(item.ticker || "").toUpperCase();
    if (!ticker) continue;
    if (!byTicker.has(ticker)) {
      byTicker.set(ticker, []);
    }
    byTicker.get(ticker)!.push({
      ticker,
      generatedAt: item.updatedAt,
      payload: item.payload,
    });
  }

  const tickers = Array.from(byTicker.keys());
  const livePriceMap = await getLiveCurrentPricesBatch(tickers);

  for (const ticker of tickers) {
    const sourceReports = byTicker.get(ticker) || [];
    const windowReports = filterReportsByWindow(sourceReports, "3m");
    if (!windowReports.length) continue;

    const summary = computeTickerSummaryAggregation(sourceReports, "3m");
    const meanTarget = safeNum(summary.overview.mean_target_price);
    const liveCurrent = safeNumOrNull(livePriceMap[ticker]);
    const fallbackCurrent = meanCurrentPriceInWindow(windowReports);
    const current = typeof liveCurrent === "number" && liveCurrent > 0 ? liveCurrent : fallbackCurrent;
    if (!current || !meanTarget) continue;

    const returnPct = ((meanTarget - current) / current) * 100;
    const overvaluation = ((current - meanTarget) / current) * 100;
    const confidenceCv =
      typeof summary.overview.mean_disagreement_score === "number" && Number.isFinite(summary.overview.mean_disagreement_score)
        ? Math.abs(summary.overview.mean_disagreement_score)
        : Number.POSITIVE_INFINITY;
    const positionPct =
      typeof summary.overview.mean_allocation_pct === "number" && Number.isFinite(summary.overview.mean_allocation_pct)
        ? summary.overview.mean_allocation_pct
        : null;
    const combinedScore = combinedDecisionScore(positionPct, returnPct);
    const adjustedScore = confidenceAdjustedScore(combinedScore, Number.isFinite(confidenceCv) ? confidenceCv : null);
    const decision = decisionFromAdjustedScore(
      typeof adjustedScore === "number" && Number.isFinite(adjustedScore) ? adjustedScore : 0,
    );

    const latestWindowReport = windowReports
      .slice()
      .sort((a, b) => reportMs(b.generatedAt) - reportMs(a.generatedAt))[0];

    rows.push({
      ticker,
      company_name:
        latestWindowReport?.payload?.header?.company_name ||
        ticker ||
        path.basename(String(ticker)),
      margin_safety_pct: returnPct,
      overvaluation_pct: overvaluation,
      dispersion: confidenceCv,
      return_pct: returnPct,
      investment_allocation_pct: positionPct,
      confidence_cv: confidenceCv,
      decision_label: decision.label,
      decision_tone: decision.tone,
      updated_at: latestWindowReport?.generatedAt || new Date().toISOString(),
    });
  }

  const topUndervalued = [...rows]
    .filter((row) => row.return_pct > 0)
    .sort((a, b) => b.return_pct - a.return_pct)
    .slice(0, 20);

  const topOvervalued = [...rows]
    .filter((row) => row.return_pct < 0)
    .sort((a, b) => a.return_pct - b.return_pct)
    .slice(0, 20);

  const topConviction = [...rows]
    .sort((a, b) => a.confidence_cv - b.confidence_cv)
    .slice(0, 20);

  const topHighestAllocation = [...rows]
    .filter(
      (row) =>
        typeof row.investment_allocation_pct === "number" &&
        Number.isFinite(row.investment_allocation_pct) &&
        Number(row.investment_allocation_pct) > 0,
    )
    .sort((a, b) => Number(b.investment_allocation_pct) - Number(a.investment_allocation_pct))
    .slice(0, 20);

  const topLowestAllocation = [...rows]
    .filter(
      (row) =>
        typeof row.investment_allocation_pct === "number" &&
        Number.isFinite(row.investment_allocation_pct) &&
        Number(row.investment_allocation_pct) < 0,
    )
    .sort((a, b) => Number(a.investment_allocation_pct) - Number(b.investment_allocation_pct))
    .slice(0, 20);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    window: "3m",
    window_hours: 24 * 90,
    count: rows.length,
    top_undervalued: topUndervalued,
    top_overvalued: topOvervalued,
    top_conviction: topConviction,
    top_highest_allocation: topHighestAllocation,
    top_lowest_allocation: topLowestAllocation,
    // Backward-compatible aliases.
    top_gems: topUndervalued,
    bubbles: topOvervalued,
    high_conviction: topConviction,
  });
}
