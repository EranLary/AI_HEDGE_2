import type { DiscoveryRow } from "@/lib/dashboard-types";
import {
  computeTickerSummaryAggregation,
  filterReportsByWindow,
  type SummarySourceReport,
  type TickerSummaryAggregation,
} from "@/lib/ticker-summary-aggregate";

export type DiscoveryLensType = "overall" | "model" | "valuator";

export type DiscoveryLensSelection = {
  type: DiscoveryLensType;
  key: string | null;
  label: string;
};

export type DiscoverySourceReport = SummarySourceReport & {
  reportId?: string;
};

export type PreparedDiscoveryTicker = {
  ticker: string;
  summary: TickerSummaryAggregation;
  current: number;
  latestUpdatedAt: string;
  companyName: string;
  sourceReportIds: string[];
};

export type PreparedDiscoveryUniverse = {
  tickers: PreparedDiscoveryTicker[];
  models: string[];
  valuators: string[];
  asOfMs: number;
};

export type ScoredDiscoveryCandidate = {
  row: DiscoveryRow;
  sourceReportIds: string[];
};

export type RankedDiscoveryRows = {
  all: DiscoveryRow[];
  topUndervalued: DiscoveryRow[];
  topOvervalued: DiscoveryRow[];
  topConviction: DiscoveryRow[];
  lowestConviction: DiscoveryRow[];
  topHighestAllocation: DiscoveryRow[];
  topLowestAllocation: DiscoveryRow[];
  topScores: DiscoveryRow[];
  lowestScores: DiscoveryRow[];
};

function safeNum(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function reportMs(value: string): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function meanCurrentPrice(reports: SummarySourceReport[]): number | null {
  const values = reports
    .map((report) => safeNumOrNull(report.payload.valuation_hub?.consensus?.current_price))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return values.length ? average(values) : null;
}

function combinedScore(investmentPct?: number | null, targetReturnPct?: number | null): number | null {
  const hasInvestment = typeof investmentPct === "number" && Number.isFinite(investmentPct);
  const hasTarget = typeof targetReturnPct === "number" && Number.isFinite(targetReturnPct);
  if (!hasInvestment && !hasTarget) return null;
  if (hasInvestment && hasTarget) return (0.4 * Number(investmentPct)) + (0.6 * Number(targetReturnPct));
  return hasInvestment ? Number(investmentPct) : Number(targetReturnPct);
}

function confidenceAdjustedScore(baseScore?: number | null, overallCv?: number | null): number | null {
  if (typeof baseScore !== "number" || !Number.isFinite(baseScore)) return null;
  const cv = typeof overallCv === "number" && Number.isFinite(overallCv) ? Math.max(0, overallCv) : 0;
  return baseScore / (1 + Math.pow(cv, 1.3));
}

function metricsForLens(
  prepared: PreparedDiscoveryTicker,
  lens: DiscoveryLensSelection,
): { target: number | null; allocation: number | null } | null {
  if (lens.type === "overall") {
    return {
      target: safeNumOrNull(prepared.summary.overview.mean_target_price),
      allocation:
        typeof prepared.summary.overview.mean_allocation_pct === "number" &&
        Number.isFinite(prepared.summary.overview.mean_allocation_pct)
          ? prepared.summary.overview.mean_allocation_pct
          : null,
    };
  }
  if (!lens.key) return null;
  const pool = lens.type === "model" ? prepared.summary.by_model : prepared.summary.by_valuator;
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

export function normalizeDiscoveryLensType(value: string | null | undefined): DiscoveryLensType {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "model" || raw === "valuator") return raw;
  return "overall";
}

export function resolveDiscoveryLens(
  lensType: DiscoveryLensType,
  lensKey: string | null,
  models: string[],
  valuators: string[],
): DiscoveryLensSelection {
  if (lensType === "model") {
    const selected = lensKey && models.includes(lensKey) ? lensKey : models[0] || null;
    return selected
      ? { type: "model", key: selected, label: `Model: ${selected}` }
      : { type: "overall", key: null, label: "Overall" };
  }
  if (lensType === "valuator") {
    const selected = lensKey && valuators.includes(lensKey) ? lensKey : valuators[0] || null;
    return selected
      ? { type: "valuator", key: selected, label: `Valuator: ${selected}` }
      : { type: "overall", key: null, label: "Overall" };
  }
  return { type: "overall", key: null, label: "Overall" };
}

export function prepareDiscoveryUniverse(args: {
  reports: DiscoverySourceReport[];
  priceByTicker: Map<string, number | null>;
  asOfMs: number;
  window?: "3m";
}): PreparedDiscoveryUniverse {
  const window = args.window || "3m";
  const byTicker = new Map<string, DiscoverySourceReport[]>();
  for (const report of args.reports) {
    const ticker = String(report.ticker || "").trim().toUpperCase();
    if (!ticker || reportMs(report.generatedAt) > args.asOfMs) continue;
    if (!byTicker.has(ticker)) byTicker.set(ticker, []);
    byTicker.get(ticker)!.push({ ...report, ticker });
  }

  const models = new Set<string>();
  const valuators = new Set<string>();
  const tickers: PreparedDiscoveryTicker[] = [];

  for (const [ticker, sourceReports] of byTicker.entries()) {
    const windowReports = filterReportsByWindow(sourceReports, window, args.asOfMs);
    if (!windowReports.length) continue;
    const summary = computeTickerSummaryAggregation(sourceReports, window, args.asOfMs);
    for (const row of summary.by_model) {
      const label = String(row.label || "").trim();
      if (label && label.toLowerCase() !== "overall") models.add(label);
    }
    for (const row of summary.by_valuator) {
      const label = String(row.label || "").trim();
      if (label) valuators.add(label);
    }

    const suppliedCurrent = safeNumOrNull(args.priceByTicker.get(ticker));
    const fallbackCurrent = meanCurrentPrice(windowReports);
    const current = suppliedCurrent && suppliedCurrent > 0 ? suppliedCurrent : fallbackCurrent;
    if (!current) continue;

    const latest = windowReports.slice().sort((a, b) => reportMs(b.generatedAt) - reportMs(a.generatedAt))[0];
    tickers.push({
      ticker,
      summary,
      current,
      latestUpdatedAt: latest?.generatedAt || new Date(args.asOfMs).toISOString(),
      companyName: latest?.payload?.header?.company_name || ticker,
      sourceReportIds: Array.from(
        new Set(windowReports.map((report) => String((report as DiscoverySourceReport).reportId || "").trim()).filter(Boolean)),
      ),
    });
  }

  return {
    tickers,
    models: Array.from(models).sort((a, b) => a.localeCompare(b)),
    valuators: Array.from(valuators).sort((a, b) => a.localeCompare(b)),
    asOfMs: args.asOfMs,
  };
}

export function scoreDiscoveryCandidates(
  universe: PreparedDiscoveryUniverse,
  lens: DiscoveryLensSelection,
): ScoredDiscoveryCandidate[] {
  const candidates: ScoredDiscoveryCandidate[] = [];
  for (const prepared of universe.tickers) {
    const metrics = metricsForLens(prepared, lens);
    if (!metrics) continue;
    const meanTarget = safeNum(metrics.target);
    if (!meanTarget) continue;
    const returnPct = ((meanTarget - prepared.current) / prepared.current) * 100;
    const confidenceCv = safeNumOrNull(prepared.summary.overview.mean_disagreement_score);
    const positionPct = metrics.allocation;
    const baseScore = combinedScore(positionPct, returnPct);
    const misaligned =
      typeof positionPct === "number" &&
      Number.isFinite(positionPct) &&
      Math.abs(positionPct) > 1e-9 &&
      Math.abs(returnPct) > 1e-9 &&
      positionPct * returnPct < 0;
    const penalizedCv = confidenceCv === null ? null : misaligned ? Math.abs(confidenceCv) * 1.5 : Math.abs(confidenceCv);
    const adjustedScore = confidenceAdjustedScore(baseScore, penalizedCv);
    candidates.push({
      row: {
        ticker: prepared.ticker,
        company_name: prepared.companyName,
        margin_safety_pct: returnPct,
        overvaluation_pct: ((prepared.current - meanTarget) / prepared.current) * 100,
        dispersion: confidenceCv ?? Number.POSITIVE_INFINITY,
        return_pct: returnPct,
        investment_allocation_pct: positionPct,
        confidence_cv: confidenceCv ?? Number.POSITIVE_INFINITY,
        points_score: adjustedScore,
        updated_at: prepared.latestUpdatedAt,
      },
      sourceReportIds: prepared.sourceReportIds,
    });
  }
  return candidates;
}

export function selectPositiveTopN(
  candidates: ScoredDiscoveryCandidate[],
  limit: number = 20,
): ScoredDiscoveryCandidate[] {
  return candidates
    .filter(({ row }) => typeof row.points_score === "number" && Number.isFinite(row.points_score) && Number(row.points_score) > 0)
    .sort((a, b) => {
      const scoreDiff = Number(b.row.points_score) - Number(a.row.points_score);
      return Math.abs(scoreDiff) > 1e-12 ? scoreDiff : a.row.ticker.localeCompare(b.row.ticker);
    })
    .slice(0, Math.max(0, limit));
}

export function rankDiscoveryRows(candidates: ScoredDiscoveryCandidate[]): RankedDiscoveryRows {
  const rows = candidates.map((candidate) => candidate.row);
  const convictionRows = rows.filter((row) => Number.isFinite(row.confidence_cv));
  return {
    all: rows,
    topUndervalued: rows.filter((row) => row.return_pct > 0).sort((a, b) => b.return_pct - a.return_pct).slice(0, 20),
    topOvervalued: rows.filter((row) => row.return_pct < 0).sort((a, b) => a.return_pct - b.return_pct).slice(0, 20),
    topConviction: [...convictionRows]
      .sort((a, b) => {
        const disagreementDiff = a.confidence_cv - b.confidence_cv;
        return Math.abs(disagreementDiff) > 1e-12 ? disagreementDiff : a.ticker.localeCompare(b.ticker);
      })
      .slice(0, 20),
    lowestConviction: [...convictionRows]
      .sort((a, b) => {
        const disagreementDiff = b.confidence_cv - a.confidence_cv;
        return Math.abs(disagreementDiff) > 1e-12 ? disagreementDiff : a.ticker.localeCompare(b.ticker);
      })
      .slice(0, 20),
    topHighestAllocation: rows
      .filter((row) => typeof row.investment_allocation_pct === "number" && Number(row.investment_allocation_pct) > 0)
      .sort((a, b) => Number(b.investment_allocation_pct) - Number(a.investment_allocation_pct))
      .slice(0, 20),
    topLowestAllocation: rows
      .filter((row) => typeof row.investment_allocation_pct === "number" && Number(row.investment_allocation_pct) < 0)
      .sort((a, b) => Number(a.investment_allocation_pct) - Number(b.investment_allocation_pct))
      .slice(0, 20),
    topScores: selectPositiveTopN(candidates).map((candidate) => candidate.row),
    lowestScores: rows
      .filter((row) => typeof row.points_score === "number" && Number.isFinite(row.points_score) && Number(row.points_score) < 0)
      .sort((a, b) => Number(a.points_score) - Number(b.points_score))
      .slice(0, 20),
  };
}

export function allDiscoveryLenses(universe: PreparedDiscoveryUniverse): DiscoveryLensSelection[] {
  return [
    { type: "overall", key: null, label: "Overall" },
    ...universe.models.map((key) => ({ type: "model" as const, key, label: key })),
    ...universe.valuators.map((key) => ({ type: "valuator" as const, key, label: key })),
  ];
}
