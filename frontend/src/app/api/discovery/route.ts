import path from "node:path";

import { NextResponse } from "next/server";

import { DashboardPayload, DiscoveryRow } from "@/lib/dashboard-types";
import { getLiveCurrentPricesBatch } from "@/lib/dashboard-server";
import { getDeletedReportFilter, siteRunIdFromPathLike } from "@/lib/deleted-reports";
import { listAllDashboardsForHitRate } from "@/lib/reports-db";
import { listDashboardReports, readJson } from "@/lib/server-outputs";
import {
  computeTickerSummaryAggregation,
  filterReportsByWindow,
  type SummarySourceReport,
} from "@/lib/ticker-summary-aggregate";

type DiscoveryLensType = "overall" | "model" | "valuator";

type LensSelection = {
  type: DiscoveryLensType;
  key: string | null;
  label: string;
};

type PreparedTicker = {
  ticker: string;
  summary: ReturnType<typeof computeTickerSummaryAggregation>;
  current: number;
  latestUpdatedAt: string;
  companyName: string;
};

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
  if (adjustedScore >= 20) return { label: "Strong Buy", tone: "buy" };
  if (adjustedScore >= 5) return { label: "Buy", tone: "buy" };
  if (adjustedScore > -5) return { label: "Hold", tone: "hold" };
  if (adjustedScore > -20) return { label: "Sell", tone: "sell" };
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

function normalizeLensType(value: string | null | undefined): DiscoveryLensType {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "model") return "model";
  if (raw === "valuator") return "valuator";
  return "overall";
}

function cleanLensKey(value: string | null | undefined): string | null {
  const key = String(value || "").trim();
  return key ? key : null;
}

function resolveLensSelection(
  lensType: DiscoveryLensType,
  lensKey: string | null,
  models: string[],
  valuators: string[],
): LensSelection {
  if (lensType === "model") {
    if (lensKey && models.includes(lensKey)) {
      return { type: "model", key: lensKey, label: `Model: ${lensKey}` };
    }
    const fallback = models[0] || null;
    if (fallback) return { type: "model", key: fallback, label: `Model: ${fallback}` };
    return { type: "overall", key: null, label: "Overall" };
  }
  if (lensType === "valuator") {
    if (lensKey && valuators.includes(lensKey)) {
      return { type: "valuator", key: lensKey, label: `Valuator: ${lensKey}` };
    }
    const fallback = valuators[0] || null;
    if (fallback) return { type: "valuator", key: fallback, label: `Valuator: ${fallback}` };
    return { type: "overall", key: null, label: "Overall" };
  }
  return { type: "overall", key: null, label: "Overall" };
}

function resolveLensMetricsForTicker(
  prepared: PreparedTicker,
  lens: LensSelection,
): { target: number | null; allocation: number | null } | null {
  const summary = prepared.summary;
  if (lens.type === "overall") {
    return {
      target: safeNumOrNull(summary.overview.mean_target_price),
      allocation:
        typeof summary.overview.mean_allocation_pct === "number" && Number.isFinite(summary.overview.mean_allocation_pct)
          ? summary.overview.mean_allocation_pct
          : null,
    };
  }
  if (!lens.key) return null;
  const pool = lens.type === "model" ? summary.by_model : summary.by_valuator;
  const row = pool.find((entry) => String(entry.label || "").trim() === lens.key);
  if (!row) return null;
  return {
    target: safeNumOrNull(row.mean_target_price),
    allocation:
      typeof row.mean_allocation_pct === "number" && Number.isFinite(row.mean_allocation_pct)
        ? row.mean_allocation_pct
        : null,
  };
}

async function loadDashboards(): Promise<
  Array<{ ticker: string; payload: DashboardPayload; updatedAt: string; sourceLabel: string }>
> {
  const merged = new Map<string, { ticker: string; payload: DashboardPayload; updatedAt: string; sourceLabel: string }>();
  const deletedFilter = await getDeletedReportFilter();

  try {
    const dbRows = await listAllDashboardsForHitRate();
    for (const r of dbRows) {
      const row = {
        ticker: String(r.ticker).toUpperCase(),
        payload: r.dashboard as DashboardPayload,
        updatedAt: new Date(r.generated_at).toISOString(),
        sourceLabel: r.ticker,
      };
      const runId = String(r.source_run_id || "").trim();
      const key = runId ? `run:${row.ticker}:${runId}` : `db:${row.ticker}:${row.updatedAt}`;
      merged.set(key, row);
    }
  } catch (err) {
    console.warn("[discovery] DB read failed:", err);
  }

  for (const entry of listDashboardReports()) {
    const payload = readJson<DashboardPayload>(entry.path);
    if (!payload) continue;
    const ticker = String(payload.ticker || entry.ticker || "").toUpperCase();
    if (!ticker) continue;
    const updatedAt =
      typeof payload.generated_at === "string" && payload.generated_at.trim()
        ? payload.generated_at
        : new Date(entry.mtimeMs).toISOString();
    const row = {
      ticker,
      payload,
      updatedAt,
      sourceLabel: entry.path,
    };
    const runId = siteRunIdFromPathLike(entry.path);
    const key = runId ? `run:${ticker}:${runId}` : `file:${entry.path}`;
    if (deletedFilter.isDeleted(entry.report_id, ticker, runId)) continue;
    if (merged.has(key)) continue;
    merged.set(key, row);
  }

  return Array.from(merged.values()).sort(
    (a, b) => Date.parse(String(b.updatedAt || "")) - Date.parse(String(a.updatedAt || "")),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedLensType = normalizeLensType(url.searchParams.get("lens_type"));
  const requestedLensKey = cleanLensKey(url.searchParams.get("lens_key"));
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
  const availableModelsSet = new Set<string>();
  const availableValuatorsSet = new Set<string>();
  const preparedTickers: PreparedTicker[] = [];

  for (const ticker of tickers) {
    const sourceReports = byTicker.get(ticker) || [];
    const windowReports = filterReportsByWindow(sourceReports, "3m");
    if (!windowReports.length) continue;

    const summary = computeTickerSummaryAggregation(sourceReports, "3m");
    const liveCurrent = safeNumOrNull(livePriceMap[ticker]);
    const fallbackCurrent = meanCurrentPriceInWindow(windowReports);
    const current = typeof liveCurrent === "number" && liveCurrent > 0 ? liveCurrent : fallbackCurrent;
    const latestWindowReport = windowReports
      .slice()
      .sort((a, b) => reportMs(b.generatedAt) - reportMs(a.generatedAt))[0];

    for (const row of summary.by_model) {
      const label = String(row.label || "").trim();
      if (label && label.toLowerCase() !== "overall") {
        availableModelsSet.add(label);
      }
    }
    for (const row of summary.by_valuator) {
      const label = String(row.label || "").trim();
      if (label) availableValuatorsSet.add(label);
    }

    if (!current) continue;
    preparedTickers.push({
      ticker,
      summary,
      current,
      latestUpdatedAt: latestWindowReport?.generatedAt || new Date().toISOString(),
      companyName:
        latestWindowReport?.payload?.header?.company_name ||
        ticker ||
        path.basename(String(ticker)),
    });
  }

  const availableModels = Array.from(availableModelsSet).sort((a, b) => a.localeCompare(b));
  const availableValuators = Array.from(availableValuatorsSet).sort((a, b) => a.localeCompare(b));
  const lens = resolveLensSelection(requestedLensType, requestedLensKey, availableModels, availableValuators);

  for (const prepared of preparedTickers) {
    const metrics = resolveLensMetricsForTicker(prepared, lens);
    if (!metrics) continue;
    const meanTarget = safeNum(metrics.target);
    if (!meanTarget) continue;

    const returnPct = ((meanTarget - prepared.current) / prepared.current) * 100;
    const overvaluation = ((prepared.current - meanTarget) / prepared.current) * 100;
    const confidenceCv =
      typeof prepared.summary.overview.mean_disagreement_score === "number" &&
      Number.isFinite(prepared.summary.overview.mean_disagreement_score)
        ? Math.abs(prepared.summary.overview.mean_disagreement_score)
        : Number.POSITIVE_INFINITY;
    const positionPct = metrics.allocation;
    const combinedScore = combinedDecisionScore(positionPct, returnPct);
    const misalignedSignal =
      typeof positionPct === "number" &&
      Number.isFinite(positionPct) &&
      typeof returnPct === "number" &&
      Number.isFinite(returnPct) &&
      Math.abs(positionPct) > 1e-9 &&
      Math.abs(returnPct) > 1e-9 &&
      (positionPct * returnPct) < 0;
    const penalizedCv = Number.isFinite(confidenceCv) ? (misalignedSignal ? confidenceCv * 1.5 : confidenceCv) : null;
    const adjustedScore = confidenceAdjustedScore(combinedScore, penalizedCv);
    const decision = decisionFromAdjustedScore(
      typeof adjustedScore === "number" && Number.isFinite(adjustedScore) ? adjustedScore : 0,
    );

    rows.push({
      ticker: prepared.ticker,
      company_name: prepared.companyName,
      margin_safety_pct: returnPct,
      overvaluation_pct: overvaluation,
      dispersion: confidenceCv,
      return_pct: returnPct,
      investment_allocation_pct: positionPct,
      confidence_cv: confidenceCv,
      points_score: typeof adjustedScore === "number" && Number.isFinite(adjustedScore) ? adjustedScore : null,
      decision_label: decision.label,
      decision_tone: decision.tone,
      updated_at: prepared.latestUpdatedAt,
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

  const topScores = [...rows]
    .filter(
      (row) =>
        typeof row.points_score === "number" &&
        Number.isFinite(row.points_score) &&
        Number(row.points_score) > 0,
    )
    .sort((a, b) => Number(b.points_score) - Number(a.points_score))
    .slice(0, 20);

  const lowestScores = [...rows]
    .filter(
      (row) =>
        typeof row.points_score === "number" &&
        Number.isFinite(row.points_score) &&
        Number(row.points_score) < 0,
    )
    .sort((a, b) => Number(a.points_score) - Number(b.points_score))
    .slice(0, 20);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    lens,
    lens_options: {
      models: availableModels,
      valuators: availableValuators,
    },
    window: "3m",
    window_hours: 24 * 90,
    count: rows.length,
    top_undervalued: topUndervalued,
    top_overvalued: topOvervalued,
    top_conviction: topConviction,
    top_highest_allocation: topHighestAllocation,
    top_lowest_allocation: topLowestAllocation,
    top_scores: topScores,
    lowest_scores: lowestScores,
    // Backward-compatible aliases.
    top_gems: topUndervalued,
    bubbles: topOvervalued,
    high_conviction: topConviction,
  });
}
