import {
  selectPositiveTopN,
  type DiscoveryLensSelection,
  type ScoredDiscoveryCandidate,
} from "@/lib/discovery-engine";
import type { Workspace } from "@/lib/workspace";

export const PORTFOLIO_EQUAL_WEIGHT_METHODOLOGY_VERSION = "top20-positive-equal-v1";
export const PORTFOLIO_SCORE_BLEND_METHODOLOGY_VERSION = "top20-positive-blend60-score40-cap2x-v2";
// Trading automation deliberately remains pinned to the original released methodology.
export const PORTFOLIO_METHODOLOGY_VERSION = PORTFOLIO_EQUAL_WEIGHT_METHODOLOGY_VERSION;
export const PORTFOLIO_BENCHMARK_SYMBOL = "^SP500TR";
export const PORTFOLIO_RISK_FREE_SYMBOL = "^IRX";
export const PORTFOLIO_RISK_FREE_NAME = "13-week U.S. Treasury Bill yield proxy";
export const PORTFOLIO_PROVIDER = "yfinance";
export const MAX_MARKET_DATA_AGE_DAYS = 5;
export const MAX_RISK_FREE_DATA_AGE_DAYS = 7;
export const PORTFOLIO_RISK_MIN_OBSERVATIONS = 20;
export const PORTFOLIO_TRADING_DAYS_PER_YEAR = 252;

export type PortfolioTrack = "backtest" | "paper";
export type PortfolioPeriod = "1m" | "3m" | "6m" | "1y" | "all";
export type PortfolioMethodologyKey = "equal" | "score_blend";
export type PortfolioMethodology = {
  key: PortfolioMethodologyKey;
  version: string;
  label: string;
  shortLabel: string;
  construction: string;
  equalWeightFraction: number;
  scoreWeightFraction: number;
  maxEqualWeightMultiple: number | null;
  tradeExecutionReleased: boolean;
};

export const PORTFOLIO_METHODOLOGIES: readonly PortfolioMethodology[] = [
  {
    key: "equal",
    version: PORTFOLIO_EQUAL_WEIGHT_METHODOLOGY_VERSION,
    label: "Equal Weight",
    shortLabel: "Equal",
    construction: "Top 20 positive scores, equally weighted at each monthly rebalance.",
    equalWeightFraction: 1,
    scoreWeightFraction: 0,
    maxEqualWeightMultiple: null,
    tradeExecutionReleased: true,
  },
  {
    key: "score_blend",
    version: PORTFOLIO_SCORE_BLEND_METHODOLOGY_VERSION,
    label: "60/40 Score Blend",
    shortLabel: "60/40",
    construction: "60% equal weight and 40% proportional to positive score, capped at 2x equal weight.",
    equalWeightFraction: 0.6,
    scoreWeightFraction: 0.4,
    maxEqualWeightMultiple: 2,
    tradeExecutionReleased: false,
  },
] as const;

export function resolvePortfolioMethodology(value?: string | null): PortfolioMethodology | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return PORTFOLIO_METHODOLOGIES[0];
  return PORTFOLIO_METHODOLOGIES.find((methodology) => (
    methodology.key === normalized || methodology.version.toLowerCase() === normalized
  )) || null;
}
export type PortfolioDataStatus = "ok" | "no_positions" | "stale_market_data";
export type PortfolioRiskStatus =
  | "ok"
  | "insufficient_history"
  | "risk_free_unavailable"
  | "stale_market_data";

export function portfolioWorkspaceConfig(workspace: Workspace) {
  return workspace === "nasdaq100"
    ? {
        benchmarkSymbol: "QQQ",
        benchmarkName: "Invesco QQQ — total-return proxy",
        universe: "Nasdaq 100 reports from active releases in the trailing 90 days, unlocked after complete universe coverage",
      }
    : {
        benchmarkSymbol: PORTFOLIO_BENCHMARK_SYMBOL,
        benchmarkName: "S&P 500 Total Return",
        universe: "Analyzed tickers with a report available in the trailing 90 days",
      };
}

export type MarketPricePoint = {
  symbol: string;
  date: string;
  adjustedCloseLocal: number;
  currency: string;
  fxToUsd: number;
  adjustedCloseUsd: number;
};

export type PortfolioHoldingDefinition = {
  rank: number;
  ticker: string;
  score: number;
  weight: number;
  currency: string;
  sourceReportIds: string[];
  entryDate: string;
  entryPriceUsd: number;
};

export type PortfolioSnapshotDefinition = {
  id: string;
  workspace: Workspace;
  track: PortfolioTrack;
  lens: DiscoveryLensSelection;
  cutoffAt: string;
  executionDate: string;
  methodologyVersion: string;
  benchmarkSymbol: string;
  benchmarkName: string;
  candidateCount: number;
  status: "ready" | "no_positions";
  holdings: PortfolioHoldingDefinition[];
};

export type PortfolioNavPoint = {
  date: string;
  snapshotId: string;
  nav: number;
  benchmarkNav: number;
  holdingsCount: number;
  status: PortfolioDataStatus;
};

export type PortfolioPeriodSummary = {
  returnPct: number | null;
  benchmarkReturnPct: number | null;
  excessReturnPct: number | null;
  portfolioVolatilityPct: number | null;
  benchmarkVolatilityPct: number | null;
  portfolioSharpe: number | null;
  benchmarkSharpe: number | null;
  riskObservationCount: number;
  riskFreeObservationCount: number;
  riskStatus: PortfolioRiskStatus;
  periodStart: string | null;
  periodEnd: string | null;
  status: PortfolioDataStatus | "insufficient_history";
};

function dateMs(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageDays(later: string, earlier: string): number {
  return Math.floor((dateMs(later) - dateMs(earlier)) / (24 * 60 * 60 * 1000));
}

export function latestPriceOnOrBefore(
  points: MarketPricePoint[],
  targetDate: string,
  maxAgeDays: number = MAX_MARKET_DATA_AGE_DAYS,
): MarketPricePoint | null {
  const eligible = points
    .filter((point) => point.date <= targetDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  const selected = eligible[0] || null;
  if (!selected || ageDays(targetDate, selected.date) > maxAgeDays) return null;
  return selected;
}

export function firstBenchmarkDateAfter(points: MarketPricePoint[], cutoffDate: string): string | null {
  return points
    .map((point) => point.date)
    .filter((value) => value > cutoffDate)
    .sort((a, b) => a.localeCompare(b))[0] || null;
}

function priceOnDate(points: MarketPricePoint[], date: string): MarketPricePoint | null {
  return points.find((point) => point.date === date) || null;
}

export function firstExecutionDateForCandidates(args: {
  candidates: ScoredDiscoveryCandidate[];
  cutoffDate: string;
  benchmarkPoints: MarketPricePoint[];
  priceBySymbol: Map<string, MarketPricePoint[]>;
  limit?: number;
}): string | null {
  const selected = selectPositiveTopN(args.candidates, args.limit || 20);
  const benchmarkDates = args.benchmarkPoints
    .map((point) => point.date)
    .filter((date) => date > args.cutoffDate)
    .sort((a, b) => a.localeCompare(b));
  if (!selected.length) return benchmarkDates[0] || null;
  return benchmarkDates.find((date) => selected.every((candidate) => (
    priceOnDate(args.priceBySymbol.get(candidate.row.ticker) || [], date) !== null
  ))) || null;
}

export function buildHoldingsForSnapshot(args: {
  candidates: ScoredDiscoveryCandidate[];
  executionDate: string;
  priceBySymbol: Map<string, MarketPricePoint[]>;
  currencyByTicker: Map<string, string>;
  methodologyVersion?: string;
  limit?: number;
}): PortfolioHoldingDefinition[] {
  const ranked = selectPositiveTopN(args.candidates, args.limit || 20);
  const selected: Array<Omit<PortfolioHoldingDefinition, "rank" | "weight">> = [];
  for (const candidate of ranked) {
    const ticker = candidate.row.ticker;
    const price = priceOnDate(args.priceBySymbol.get(ticker) || [], args.executionDate);
    const currency = String(args.currencyByTicker.get(ticker) || "").trim().toUpperCase();
    if (!price || !currency) {
      throw new Error(`Missing execution price or currency for ${ticker} on ${args.executionDate}.`);
    }
    selected.push({
      ticker,
      score: Number(candidate.row.points_score),
      currency,
      sourceReportIds: candidate.sourceReportIds,
      entryDate: args.executionDate,
      entryPriceUsd: price.adjustedCloseUsd,
    });
  }
  const methodology = resolvePortfolioMethodology(args.methodologyVersion);
  if (!methodology) {
    throw new Error(`Unknown portfolio methodology: ${args.methodologyVersion}`);
  }
  const weights = calculatePortfolioWeights(selected.map((holding) => holding.score), methodology);
  return selected.map((holding, index) => ({ ...holding, rank: index + 1, weight: weights[index] }));
}

export function calculatePortfolioWeights(
  scores: number[],
  methodology: PortfolioMethodology = PORTFOLIO_METHODOLOGIES[0],
): number[] {
  const count = scores.length;
  if (!count) return [];
  if (scores.some((score) => !Number.isFinite(score) || score <= 0)) {
    throw new Error("Portfolio scores must be finite positive numbers.");
  }

  const equalWeight = 1 / count;
  const scoreTotal = scores.reduce((sum, score) => sum + score, 0);
  const rawWeights = scores.map((score) => (
    (methodology.equalWeightFraction * equalWeight)
    + (methodology.scoreWeightFraction * (score / scoreTotal))
  ));
  if (methodology.maxEqualWeightMultiple === null) return rawWeights;

  const cap = Math.min(1, methodology.maxEqualWeightMultiple * equalWeight);
  const weights = Array(count).fill(0) as number[];
  let remainingIndices = rawWeights.map((_, index) => index);
  let remainingWeight = 1;

  // Redistribute any capped excess proportionally across the still-uncapped raw weights.
  while (remainingIndices.length) {
    const remainingRawTotal = remainingIndices.reduce((sum, index) => sum + rawWeights[index], 0);
    const cappedIndices = remainingIndices.filter((index) => (
      (rawWeights[index] / remainingRawTotal) * remainingWeight > cap + Number.EPSILON
    ));
    if (!cappedIndices.length) {
      for (const index of remainingIndices) {
        weights[index] = (rawWeights[index] / remainingRawTotal) * remainingWeight;
      }
      break;
    }
    for (const index of cappedIndices) weights[index] = cap;
    remainingWeight -= cap * cappedIndices.length;
    const cappedSet = new Set(cappedIndices);
    remainingIndices = remainingIndices.filter((index) => !cappedSet.has(index));
  }

  return weights;
}

export function computePortfolioNavSeries(args: {
  snapshots: PortfolioSnapshotDefinition[];
  priceBySymbol: Map<string, MarketPricePoint[]>;
  benchmarkPoints: MarketPricePoint[];
  throughDate?: string;
}): PortfolioNavPoint[] {
  const snapshots = args.snapshots
    .slice()
    .sort((a, b) => a.executionDate.localeCompare(b.executionDate));
  if (!snapshots.length) return [];
  const throughDate = args.throughDate || "9999-12-31";
  const benchmark = args.benchmarkPoints
    .filter((point) => point.date >= snapshots[0].executionDate && point.date <= throughDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!benchmark.length || benchmark[0].date !== snapshots[0].executionDate) return [];

  const output: PortfolioNavPoint[] = [];
  let activeSnapshot: PortfolioSnapshotDefinition = snapshots[0];
  let snapshotIndex = 1;
  let nav = 100;
  let benchmarkNav = 100;
  let lastBenchmarkPrice = benchmark[0].adjustedCloseUsd;
  let holdingValues = new Map<string, number>();
  let lastHoldingPrices = new Map<string, number>();

  const activate = (snapshot: PortfolioSnapshotDefinition) => {
    activeSnapshot = snapshot;
    holdingValues = new Map();
    lastHoldingPrices = new Map();
    for (const holding of snapshot.holdings) {
      const currentAdjustedEntry = priceOnDate(
        args.priceBySymbol.get(holding.ticker) || [],
        snapshot.executionDate,
      )?.adjustedCloseUsd;
      holdingValues.set(holding.ticker, nav * holding.weight);
      lastHoldingPrices.set(holding.ticker, currentAdjustedEntry || holding.entryPriceUsd);
    }
  };

  activate(activeSnapshot);

  for (let index = 0; index < benchmark.length; index += 1) {
    const benchmarkPoint = benchmark[index];
    const date = benchmarkPoint.date;
    if (index > 0) {
      benchmarkNav *= benchmarkPoint.adjustedCloseUsd / lastBenchmarkPrice;
      lastBenchmarkPrice = benchmarkPoint.adjustedCloseUsd;
    }

    let pointStatus: PortfolioDataStatus = activeSnapshot.holdings.length ? "ok" : "no_positions";
    if (activeSnapshot.holdings.length) {
      const nextValues = new Map<string, number>();
      const nextPrices = new Map<string, number>();
      let stale = false;
      for (const holding of activeSnapshot.holdings) {
        const currentPrice = latestPriceOnOrBefore(args.priceBySymbol.get(holding.ticker) || [], date);
        const previousPrice = lastHoldingPrices.get(holding.ticker);
        const previousValue = holdingValues.get(holding.ticker);
        if (!currentPrice || !previousPrice || previousValue === undefined) {
          stale = true;
          break;
        }
        nextValues.set(holding.ticker, previousValue * (currentPrice.adjustedCloseUsd / previousPrice));
        nextPrices.set(holding.ticker, currentPrice.adjustedCloseUsd);
      }
      if (!stale) {
        holdingValues = nextValues;
        lastHoldingPrices = nextPrices;
        nav = Array.from(holdingValues.values()).reduce((sum, value) => sum + value, 0);
      } else {
        pointStatus = "stale_market_data";
      }
    }

    const pendingSnapshot = snapshots[snapshotIndex];
    if (pendingSnapshot && pendingSnapshot.executionDate === date) {
      activate(pendingSnapshot);
      snapshotIndex += 1;
      if (pointStatus !== "stale_market_data") {
        pointStatus = activeSnapshot.holdings.length ? "ok" : "no_positions";
      }
    }
    output.push({
      date,
      snapshotId: activeSnapshot.id,
      nav,
      benchmarkNav,
      holdingsCount: activeSnapshot.holdings.length,
      status: pointStatus,
    });
  }
  return output;
}

function subtractPeriod(dateValue: string, period: Exclude<PortfolioPeriod, "all">): string {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (period === "1y") date.setUTCFullYear(date.getUTCFullYear() - 1);
  else date.setUTCMonth(date.getUTCMonth() - Number(period.replace("m", "")));
  return date.toISOString().slice(0, 10);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
  const standardDeviation = Math.sqrt(variance);
  return Number.isFinite(standardDeviation) ? standardDeviation : null;
}

function annualizedVolatilityPct(returns: number[]): number | null {
  const standardDeviation = sampleStandardDeviation(returns);
  return standardDeviation === null ? null : standardDeviation * Math.sqrt(PORTFOLIO_TRADING_DAYS_PER_YEAR) * 100;
}

function annualizedSharpe(returns: number[], dailyRiskFreeReturns: number[]): number | null {
  if (returns.length !== dailyRiskFreeReturns.length || returns.length < 2) return null;
  const standardDeviation = sampleStandardDeviation(returns);
  if (standardDeviation === null || standardDeviation <= Number.EPSILON) return null;
  const excessReturns = returns.map((value, index) => value - dailyRiskFreeReturns[index]);
  const sharpe = (mean(excessReturns) / standardDeviation) * Math.sqrt(PORTFOLIO_TRADING_DAYS_PER_YEAR);
  return Number.isFinite(sharpe) ? sharpe : null;
}

function dailyRiskFreeReturn(annualYieldPct: number): number | null {
  if (!Number.isFinite(annualYieldPct) || annualYieldPct < 0) return null;
  const dailyReturn = ((1 + (annualYieldPct / 100)) ** (1 / PORTFOLIO_TRADING_DAYS_PER_YEAR)) - 1;
  return Number.isFinite(dailyReturn) ? dailyReturn : null;
}

function emptyRiskSummary(riskStatus: PortfolioRiskStatus, riskObservationCount = 0) {
  return {
    portfolioVolatilityPct: null,
    benchmarkVolatilityPct: null,
    portfolioSharpe: null,
    benchmarkSharpe: null,
    riskObservationCount,
    riskFreeObservationCount: 0,
    riskStatus,
  };
}

function dailyReturnSeries(points: PortfolioNavPoint[]) {
  const portfolioReturns: number[] = [];
  const benchmarkReturns: number[] = [];
  const returnDates: string[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.nav <= 0 || current.nav < 0 || previous.benchmarkNav <= 0 || current.benchmarkNav < 0) continue;
    const portfolioReturn = (current.nav / previous.nav) - 1;
    const benchmarkReturn = (current.benchmarkNav / previous.benchmarkNav) - 1;
    if (!Number.isFinite(portfolioReturn) || !Number.isFinite(benchmarkReturn)) continue;
    portfolioReturns.push(portfolioReturn);
    benchmarkReturns.push(benchmarkReturn);
    returnDates.push(current.date);
  }
  return { portfolioReturns, benchmarkReturns, returnDates };
}

function summarizeRisk(
  points: PortfolioNavPoint[],
  riskFreePoints: MarketPricePoint[],
): Pick<
  PortfolioPeriodSummary,
  | "portfolioVolatilityPct"
  | "benchmarkVolatilityPct"
  | "portfolioSharpe"
  | "benchmarkSharpe"
  | "riskObservationCount"
  | "riskFreeObservationCount"
  | "riskStatus"
> {
  const { portfolioReturns, benchmarkReturns, returnDates } = dailyReturnSeries(points);

  const riskObservationCount = portfolioReturns.length;
  if (points.some((point) => point.status === "stale_market_data")) {
    return emptyRiskSummary("stale_market_data", riskObservationCount);
  }
  if (riskObservationCount < PORTFOLIO_RISK_MIN_OBSERVATIONS) {
    return emptyRiskSummary("insufficient_history", riskObservationCount);
  }

  const dailyRiskFreeReturns: number[] = [];
  for (const date of returnDates) {
    const point = latestPriceOnOrBefore(riskFreePoints, date, MAX_RISK_FREE_DATA_AGE_DAYS);
    const dailyReturn = point ? dailyRiskFreeReturn(point.adjustedCloseLocal) : null;
    if (dailyReturn === null) break;
    dailyRiskFreeReturns.push(dailyReturn);
  }
  const hasCompleteRiskFreeSeries = dailyRiskFreeReturns.length === riskObservationCount;
  return {
    portfolioVolatilityPct: annualizedVolatilityPct(portfolioReturns),
    benchmarkVolatilityPct: annualizedVolatilityPct(benchmarkReturns),
    portfolioSharpe: hasCompleteRiskFreeSeries ? annualizedSharpe(portfolioReturns, dailyRiskFreeReturns) : null,
    benchmarkSharpe: hasCompleteRiskFreeSeries ? annualizedSharpe(benchmarkReturns, dailyRiskFreeReturns) : null,
    riskObservationCount,
    riskFreeObservationCount: dailyRiskFreeReturns.length,
    riskStatus: hasCompleteRiskFreeSeries ? "ok" : "risk_free_unavailable",
  };
}

export function summarizePortfolioPeriod(
  points: PortfolioNavPoint[],
  period: PortfolioPeriod,
  riskFreePoints: MarketPricePoint[] = [],
): PortfolioPeriodSummary {
  const sorted = points.slice().sort((a, b) => a.date.localeCompare(b.date));
  const end = sorted[sorted.length - 1];
  if (!end) {
    return {
      returnPct: null,
      benchmarkReturnPct: null,
      excessReturnPct: null,
      ...emptyRiskSummary("insufficient_history"),
      periodStart: null,
      periodEnd: null,
      status: "insufficient_history",
    };
  }
  let start = sorted[0];
  if (period !== "all") {
    const boundary = subtractPeriod(end.date, period);
    if (sorted[0].date > boundary) {
      return {
        returnPct: null,
        benchmarkReturnPct: null,
        excessReturnPct: null,
        ...emptyRiskSummary("insufficient_history", dailyReturnSeries(sorted).portfolioReturns.length),
        periodStart: null,
        periodEnd: end.date,
        status: "insufficient_history",
      };
    }
    start = sorted.filter((point) => point.date <= boundary).slice(-1)[0] || sorted[0];
  }
  const returnPct = start.nav > 0 ? ((end.nav / start.nav) - 1) * 100 : null;
  const benchmarkReturnPct = start.benchmarkNav > 0 ? ((end.benchmarkNav / start.benchmarkNav) - 1) * 100 : null;
  const periodPoints = sorted.filter((point) => point.date >= start.date && point.date <= end.date);
  const status = periodPoints.some((point) => point.status === "stale_market_data")
    ? "stale_market_data"
    : end.status;
  const riskSummary = summarizeRisk(periodPoints, riskFreePoints);
  return {
    returnPct,
    benchmarkReturnPct,
    excessReturnPct:
      returnPct === null || benchmarkReturnPct === null ? null : returnPct - benchmarkReturnPct,
    ...riskSummary,
    periodStart: start.date,
    periodEnd: end.date,
    status,
  };
}
