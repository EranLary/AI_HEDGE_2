import { NextResponse } from "next/server";

import { loadMarketPrices, loadPortfolioNav, type StoredPortfolioNavPoint } from "@/lib/portfolio-db";
import {
  PORTFOLIO_METHODOLOGY_VERSION,
  PORTFOLIO_PROVIDER,
  PORTFOLIO_RISK_FREE_NAME,
  PORTFOLIO_RISK_FREE_SYMBOL,
  PORTFOLIO_RISK_MIN_OBSERVATIONS,
  PORTFOLIO_TRADING_DAYS_PER_YEAR,
  portfolioWorkspaceConfig,
  summarizePortfolioPeriod,
  type MarketPricePoint,
  type PortfolioPeriod,
  type PortfolioTrack,
} from "@/lib/portfolio-performance-engine";
import { parseApiWorkspace, type Workspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_PERIODS = new Set<PortfolioPeriod>(["1m", "3m", "6m", "1y", "all"]);

function parseTrack(value: string | null): PortfolioTrack {
  return value === "backtest" ? "backtest" : "paper";
}

function parsePeriod(value: string | null): PortfolioPeriod {
  const normalized = String(value || "all").toLowerCase() as PortfolioPeriod;
  return VALID_PERIODS.has(normalized) ? normalized : "all";
}

function groupByLens(rows: StoredPortfolioNavPoint[]): StoredPortfolioNavPoint[][] {
  const grouped = new Map<string, StoredPortfolioNavPoint[]>();
  for (const row of rows) {
    const key = `${row.lensType}:${row.lensKey}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  return Array.from(grouped.values());
}

function summarizeLens(
  rows: StoredPortfolioNavPoint[],
  period: PortfolioPeriod,
  riskFreePoints: MarketPricePoint[],
) {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const summary = summarizePortfolioPeriod(sorted, period, riskFreePoints);
  const latest = sorted[sorted.length - 1];
  return {
    lens_type: latest.lensType,
    lens_key: latest.lensType === "overall" ? null : latest.lensKey,
    label: latest.lensType === "overall" ? "Overall" : latest.lensLabel,
    return_pct: summary.returnPct,
    benchmark_return_pct: summary.benchmarkReturnPct,
    excess_return_pct: summary.excessReturnPct,
    portfolio_volatility_pct: summary.portfolioVolatilityPct,
    benchmark_volatility_pct: summary.benchmarkVolatilityPct,
    portfolio_sharpe: summary.portfolioSharpe,
    benchmark_sharpe: summary.benchmarkSharpe,
    risk_observation_count: summary.riskObservationCount,
    risk_free_observation_count: summary.riskFreeObservationCount,
    risk_status: summary.riskStatus,
    holdings_count: latest.holdingsCount,
    period_start: summary.periodStart,
    period_end: summary.periodEnd,
    status: summary.status,
  };
}

function emptyResponse(workspace: Workspace, track: PortfolioTrack, period: PortfolioPeriod, message?: string) {
  const config = portfolioWorkspaceConfig(workspace);
  return {
    generated_at: new Date().toISOString(),
    track,
    period,
    available: false,
    workspace,
    message: message || (workspace === "nasdaq100"
      ? "Nasdaq 100 portfolio history will appear after the first release is activated and portfolios are refreshed."
      : "Portfolio performance history is not available yet."),
    methodology: {
      version: PORTFOLIO_METHODOLOGY_VERSION,
      universe: config.universe,
      construction: "Up to 20 positive-score stocks, equally weighted, rebalanced monthly",
      score: "60% implied target return + 40% allocation, confidence-disagreement penalty applied",
      base_currency: "USD",
      return_type: "Gross simulated total return; no fees, slippage, tax, or cash interest",
      benchmark_symbol: config.benchmarkSymbol,
      benchmark_name: config.benchmarkName,
      market_data_provider: PORTFOLIO_PROVIDER,
      risk_free_symbol: PORTFOLIO_RISK_FREE_SYMBOL,
      risk_free_name: PORTFOLIO_RISK_FREE_NAME,
      risk_calculation: "Annualized from daily returns; Sharpe uses a daily-matched short-term Treasury yield",
      annualization_trading_days: PORTFOLIO_TRADING_DAYS_PER_YEAR,
      minimum_risk_observations: PORTFOLIO_RISK_MIN_OBSERVATIONS,
      public_beta: true,
    },
    range: { start: null, end: null },
    by_model: [],
    by_valuator: [],
  };
}

function daysBefore(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const track = parseTrack(url.searchParams.get("track"));
  const period = parsePeriod(url.searchParams.get("period"));
  const workspace = parseApiWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  try {
    const rows = await loadPortfolioNav(workspace, track, PORTFOLIO_METHODOLOGY_VERSION);
    if (!rows.length) return NextResponse.json(emptyResponse(workspace, track, period));
    const dates = rows.map((row) => row.date).sort();
    const riskFreePrices = await loadMarketPrices({
      symbols: [PORTFOLIO_RISK_FREE_SYMBOL],
      startDate: daysBefore(dates[0], 10),
      endDate: dates[dates.length - 1],
      source: PORTFOLIO_PROVIDER,
    });
    const riskFreePoints = riskFreePrices.get(PORTFOLIO_RISK_FREE_SYMBOL) || [];
    const summaries = groupByLens(rows)
      .map((group) => summarizeLens(group, period, riskFreePoints))
      .sort((a, b) => {
        if (a.lens_type === "overall") return -1;
        if (b.lens_type === "overall") return 1;
        return a.label.localeCompare(b.label);
      });
    return NextResponse.json({
      ...emptyResponse(workspace, track, period),
      available: true,
      message: null,
      range: { start: dates[0], end: dates[dates.length - 1] },
      by_model: summaries.filter((row) => row.lens_type === "overall" || row.lens_type === "model"),
      by_valuator: summaries.filter((row) => row.lens_type === "valuator"),
    });
  } catch (error) {
    console.warn("[portfolio-performance] DB read failed:", error);
    return NextResponse.json(emptyResponse(workspace, track, period));
  }
}
