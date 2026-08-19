import { NextResponse } from "next/server";

import { loadPortfolioNav, type StoredPortfolioNavPoint } from "@/lib/portfolio-db";
import {
  PORTFOLIO_BENCHMARK_SYMBOL,
  PORTFOLIO_METHODOLOGY_VERSION,
  PORTFOLIO_PROVIDER,
  summarizePortfolioPeriod,
  type PortfolioPeriod,
  type PortfolioTrack,
} from "@/lib/portfolio-performance-engine";

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

function summarizeLens(rows: StoredPortfolioNavPoint[], period: PortfolioPeriod) {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const summary = summarizePortfolioPeriod(sorted, period);
  const latest = sorted[sorted.length - 1];
  return {
    lens_type: latest.lensType,
    lens_key: latest.lensType === "overall" ? null : latest.lensKey,
    label: latest.lensType === "overall" ? "Overall" : latest.lensLabel,
    return_pct: summary.returnPct,
    benchmark_return_pct: summary.benchmarkReturnPct,
    excess_return_pct: summary.excessReturnPct,
    holdings_count: latest.holdingsCount,
    period_start: summary.periodStart,
    period_end: summary.periodEnd,
    status: summary.status,
  };
}

function emptyResponse(track: PortfolioTrack, period: PortfolioPeriod, message?: string) {
  return {
    generated_at: new Date().toISOString(),
    track,
    period,
    available: false,
    message: message || "Portfolio performance history is not available yet.",
    methodology: {
      version: PORTFOLIO_METHODOLOGY_VERSION,
      universe: "Analyzed tickers with a report available in the trailing 90 days",
      construction: "Up to 20 positive-score stocks, equally weighted, rebalanced monthly",
      score: "60% implied target return + 40% allocation, confidence-disagreement penalty applied",
      base_currency: "USD",
      return_type: "Gross simulated total return; no fees, slippage, tax, or cash interest",
      benchmark_symbol: PORTFOLIO_BENCHMARK_SYMBOL,
      benchmark_name: "S&P 500 Total Return",
      market_data_provider: PORTFOLIO_PROVIDER,
      public_beta: true,
    },
    range: { start: null, end: null },
    by_model: [],
    by_valuator: [],
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const track = parseTrack(url.searchParams.get("track"));
  const period = parsePeriod(url.searchParams.get("period"));
  try {
    const rows = await loadPortfolioNav(track, PORTFOLIO_METHODOLOGY_VERSION);
    if (!rows.length) return NextResponse.json(emptyResponse(track, period));
    const summaries = groupByLens(rows)
      .map((group) => summarizeLens(group, period))
      .sort((a, b) => {
        if (a.lens_type === "overall") return -1;
        if (b.lens_type === "overall") return 1;
        return a.label.localeCompare(b.label);
      });
    const dates = rows.map((row) => row.date).sort();
    return NextResponse.json({
      ...emptyResponse(track, period),
      available: true,
      message: null,
      range: { start: dates[0], end: dates[dates.length - 1] },
      by_model: summaries.filter((row) => row.lens_type === "overall" || row.lens_type === "model"),
      by_valuator: summaries.filter((row) => row.lens_type === "valuator"),
    });
  } catch (error) {
    console.warn("[portfolio-performance] DB read failed:", error);
    return NextResponse.json(emptyResponse(track, period));
  }
}
