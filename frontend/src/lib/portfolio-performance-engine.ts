import {
  selectPositiveTopN,
  type DiscoveryLensSelection,
  type ScoredDiscoveryCandidate,
} from "@/lib/discovery-engine";
import type { Workspace } from "@/lib/workspace";

export const PORTFOLIO_METHODOLOGY_VERSION = "top20-positive-equal-v1";
export const PORTFOLIO_BENCHMARK_SYMBOL = "^SP500TR";
export const PORTFOLIO_PROVIDER = "yfinance";
export const MAX_MARKET_DATA_AGE_DAYS = 5;

export type PortfolioTrack = "backtest" | "paper";
export type PortfolioPeriod = "1m" | "3m" | "6m" | "1y" | "all";
export type PortfolioDataStatus = "ok" | "no_positions" | "stale_market_data";

export function portfolioWorkspaceConfig(workspace: Workspace) {
  return workspace === "nasdaq100"
    ? {
        benchmarkSymbol: "QQQ",
        benchmarkName: "Invesco QQQ — total-return proxy",
        universe: "Nasdaq 100 reports from active releases in the trailing 90 days",
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
  const weight = selected.length ? 1 / selected.length : 0;
  return selected.map((holding, index) => ({ ...holding, rank: index + 1, weight }));
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

export function summarizePortfolioPeriod(
  points: PortfolioNavPoint[],
  period: PortfolioPeriod,
): PortfolioPeriodSummary {
  const sorted = points.slice().sort((a, b) => a.date.localeCompare(b.date));
  const end = sorted[sorted.length - 1];
  if (!end) {
    return {
      returnPct: null,
      benchmarkReturnPct: null,
      excessReturnPct: null,
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
  return {
    returnPct,
    benchmarkReturnPct,
    excessReturnPct:
      returnPct === null || benchmarkReturnPct === null ? null : returnPct - benchmarkReturnPct,
    periodStart: start.date,
    periodEnd: end.date,
    status,
  };
}
