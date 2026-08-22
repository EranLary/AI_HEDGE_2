import assert from "node:assert/strict";
import test from "node:test";

import type { ScoredDiscoveryCandidate } from "./discovery-engine";
import {
  buildHoldingsForSnapshot,
  computePortfolioNavSeries,
  firstBenchmarkDateAfter,
  firstExecutionDateForCandidates,
  PORTFOLIO_RISK_MIN_OBSERVATIONS,
  PORTFOLIO_TRADING_DAYS_PER_YEAR,
  portfolioWorkspaceConfig,
  summarizePortfolioPeriod,
  type MarketPricePoint,
  type PortfolioSnapshotDefinition,
} from "./portfolio-performance-engine";

function price(symbol: string, date: string, adjustedCloseUsd: number, currency = "USD"): MarketPricePoint {
  return { symbol, date, adjustedCloseLocal: adjustedCloseUsd, currency, fxToUsd: 1, adjustedCloseUsd };
}

function candidate(ticker: string, score: number): ScoredDiscoveryCandidate {
  return {
    sourceReportIds: [],
    row: {
      ticker,
      company_name: ticker,
      margin_safety_pct: score,
      overvaluation_pct: -score,
      dispersion: 0,
      return_pct: score,
      investment_allocation_pct: score,
      confidence_cv: 0,
      points_score: score,
      updated_at: "2026-05-01T00:00:00Z",
    },
  };
}

test("snapshot construction selects at most 20 positive names with equal 1/N weights", () => {
  const candidates = Array.from({ length: 23 }, (_, index) => candidate(`T${String(index).padStart(2, "0")}`, 23 - index));
  candidates.push(candidate("NEG", -1));
  const priceBySymbol = new Map<string, MarketPricePoint[]>();
  const currencyByTicker = new Map<string, string>();
  for (const item of candidates) {
    priceBySymbol.set(item.row.ticker, [price(item.row.ticker, "2026-05-04", 100)]);
    currencyByTicker.set(item.row.ticker, "USD");
  }
  const holdings = buildHoldingsForSnapshot({ candidates, executionDate: "2026-05-04", priceBySymbol, currencyByTicker });
  assert.equal(holdings.length, 20);
  assert.ok(holdings.every((holding) => Math.abs(holding.weight - 0.05) < 1e-12));
  assert.equal(holdings[0].ticker, "T00");
  assert.equal(holdings[19].ticker, "T19");

  const three = buildHoldingsForSnapshot({
    candidates: candidates.slice(0, 3),
    executionDate: "2026-05-04",
    priceBySymbol,
    currencyByTicker,
  });
  assert.equal(three.length, 3);
  assert.ok(three.every((holding) => Math.abs(holding.weight - (1 / 3)) < 1e-12));

  const cash = buildHoldingsForSnapshot({
    candidates: [candidate("NEG", -1)],
    executionDate: "2026-05-04",
    priceBySymbol,
    currencyByTicker,
  });
  assert.deepEqual(cash, []);
});

function snapshot(args: { id: string; executionDate: string; ticker: string; entryPrice: number }): PortfolioSnapshotDefinition {
  return {
    id: args.id,
    workspace: "analysis",
    track: "backtest",
    lens: { type: "overall", key: null, label: "Overall" },
    cutoffAt: `${args.executionDate}T00:00:00Z`,
    executionDate: args.executionDate,
    methodologyVersion: "test",
    benchmarkSymbol: "^SP500TR",
    benchmarkName: "S&P 500 Total Return",
    candidateCount: 1,
    status: "ready",
    holdings: [{
      rank: 1,
      ticker: args.ticker,
      score: 1,
      weight: 1,
      currency: "USD",
      sourceReportIds: [],
      entryDate: args.executionDate,
      entryPriceUsd: args.entryPrice,
    }],
  };
}

test("workspace config keeps Analysis on SP500TR and Nasdaq 100 on the QQQ adjusted-close proxy", () => {
  const analysis = portfolioWorkspaceConfig("analysis");
  const nasdaq = portfolioWorkspaceConfig("nasdaq100");
  assert.equal(analysis.benchmarkSymbol, "^SP500TR");
  assert.equal(analysis.benchmarkName, "S&P 500 Total Return");
  assert.equal(nasdaq.benchmarkSymbol, "QQQ");
  assert.equal(nasdaq.benchmarkName, "Invesco QQQ — total-return proxy");
  assert.match(nasdaq.universe, /active releases/i);
});

test("NAV starts flat at the execution close and rebalances only on the next snapshot date", () => {
  const benchmark = [
    price("^SP500TR", "2026-05-04", 200),
    price("^SP500TR", "2026-05-05", 202),
    price("^SP500TR", "2026-05-06", 204),
    price("^SP500TR", "2026-05-07", 206),
  ];
  const prices = new Map<string, MarketPricePoint[]>([
    ["AAA", [price("AAA", "2026-05-04", 100), price("AAA", "2026-05-05", 110), price("AAA", "2026-05-06", 121)]],
    ["BBB", [price("BBB", "2026-05-06", 50), price("BBB", "2026-05-07", 55)]],
  ]);
  const nav = computePortfolioNavSeries({
    snapshots: [
      snapshot({ id: "s1", executionDate: "2026-05-04", ticker: "AAA", entryPrice: 100 }),
      snapshot({ id: "s2", executionDate: "2026-05-06", ticker: "BBB", entryPrice: 50 }),
    ],
    priceBySymbol: prices,
    benchmarkPoints: benchmark,
  });
  assert.equal(nav[0].nav, 100);
  assert.ok(Math.abs(nav[1].nav - 110) < 1e-9);
  assert.ok(Math.abs(nav[2].nav - 121) < 1e-9);
  assert.equal(nav[2].snapshotId, "s2");
  assert.ok(Math.abs(nav[3].nav - 133.1) < 1e-9);
});

test("benchmark execution is the first session after cutoff and stale points taint the period", () => {
  const benchmark = [price("^SP500TR", "2026-05-01", 100), price("^SP500TR", "2026-05-04", 101)];
  assert.equal(firstBenchmarkDateAfter(benchmark, "2026-05-01"), "2026-05-04");

  const nav = computePortfolioNavSeries({
    snapshots: [snapshot({ id: "s1", executionDate: "2026-05-01", ticker: "AAA", entryPrice: 100 })],
    priceBySymbol: new Map([["AAA", [price("AAA", "2026-05-01", 100), price("AAA", "2026-05-08", 108)]]]),
    benchmarkPoints: [
      price("^SP500TR", "2026-05-01", 100),
      price("^SP500TR", "2026-05-07", 101),
      price("^SP500TR", "2026-05-08", 102),
    ],
  });
  assert.equal(nav[1].status, "stale_market_data");
  assert.equal(nav[2].status, "ok");
  assert.equal(summarizePortfolioPeriod(nav, "all").status, "stale_market_data");
  assert.equal(summarizePortfolioPeriod(nav, "all").riskStatus, "stale_market_data");
  assert.equal(summarizePortfolioPeriod(nav, "3m").status, "insufficient_history");
});

test("risk summary annualizes daily volatility and Sharpe against matched Treasury yields", () => {
  const portfolioReturns = Array.from({ length: PORTFOLIO_RISK_MIN_OBSERVATIONS }, (_, index) => (
    index % 2 === 0 ? 0.01 : -0.005
  ));
  const benchmarkReturns = Array.from({ length: PORTFOLIO_RISK_MIN_OBSERVATIONS }, (_, index) => (
    index % 2 === 0 ? 0.005 : -0.002
  ));
  let nav = 100;
  let benchmarkNav = 100;
  const points = [{
    date: "2026-06-01",
    snapshotId: "s1",
    nav,
    benchmarkNav,
    holdingsCount: 1,
    status: "ok" as const,
  }];
  for (let index = 0; index < portfolioReturns.length; index += 1) {
    nav *= 1 + portfolioReturns[index];
    benchmarkNav *= 1 + benchmarkReturns[index];
    const date = new Date(Date.UTC(2026, 5, index + 2)).toISOString().slice(0, 10);
    points.push({ date, snapshotId: "s1", nav, benchmarkNav, holdingsCount: 1, status: "ok" as const });
  }
  const riskFree = points.map((point) => price("^IRX", point.date, 5));
  const summary = summarizePortfolioPeriod(points, "all", riskFree);
  const sampleStdDev = (values: number[]) => {
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
  };
  const portfolioStdDev = sampleStdDev(portfolioReturns);
  const benchmarkStdDev = sampleStdDev(benchmarkReturns);
  const dailyRiskFree = (1.05 ** (1 / PORTFOLIO_TRADING_DAYS_PER_YEAR)) - 1;
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

  assert.equal(summary.riskStatus, "ok");
  assert.equal(summary.riskObservationCount, PORTFOLIO_RISK_MIN_OBSERVATIONS);
  assert.equal(summary.riskFreeObservationCount, PORTFOLIO_RISK_MIN_OBSERVATIONS);
  assert.ok(Math.abs((summary.portfolioVolatilityPct || 0) - (portfolioStdDev * Math.sqrt(252) * 100)) < 1e-9);
  assert.ok(Math.abs((summary.benchmarkVolatilityPct || 0) - (benchmarkStdDev * Math.sqrt(252) * 100)) < 1e-9);
  assert.ok(Math.abs((summary.portfolioSharpe || 0) - (((average(portfolioReturns) - dailyRiskFree) / portfolioStdDev) * Math.sqrt(252))) < 1e-9);
  assert.ok(Math.abs((summary.benchmarkSharpe || 0) - (((average(benchmarkReturns) - dailyRiskFree) / benchmarkStdDev) * Math.sqrt(252))) < 1e-9);
});

test("risk summary waits for enough returns and keeps volatility when Treasury data is missing", () => {
  const points = Array.from({ length: PORTFOLIO_RISK_MIN_OBSERVATIONS + 1 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10),
    snapshotId: "s1",
    nav: 100 + index,
    benchmarkNav: 100 + (index * 0.5),
    holdingsCount: 1,
    status: "ok" as const,
  }));
  const short = summarizePortfolioPeriod(points.slice(0, PORTFOLIO_RISK_MIN_OBSERVATIONS), "all", []);
  assert.equal(short.riskStatus, "insufficient_history");
  assert.equal(short.riskObservationCount, PORTFOLIO_RISK_MIN_OBSERVATIONS - 1);
  assert.equal(short.portfolioVolatilityPct, null);

  const missingTreasury = summarizePortfolioPeriod(points, "all", []);
  assert.equal(missingTreasury.riskStatus, "risk_free_unavailable");
  assert.equal(missingTreasury.riskFreeObservationCount, 0);
  assert.notEqual(missingTreasury.portfolioVolatilityPct, null);
  assert.notEqual(missingTreasury.benchmarkVolatilityPct, null);
  assert.equal(missingTreasury.portfolioSharpe, null);
  assert.equal(missingTreasury.benchmarkSharpe, null);
});

test("execution waits for a common valid session across different market holidays", () => {
  const candidates = [candidate("US", 10), candidate("IL", 9)];
  const benchmark = [
    price("^SP500TR", "2026-05-04", 100),
    price("^SP500TR", "2026-05-05", 101),
  ];
  const executionDate = firstExecutionDateForCandidates({
    candidates,
    cutoffDate: "2026-05-01",
    benchmarkPoints: benchmark,
    priceBySymbol: new Map([
      ["US", [price("US", "2026-05-04", 50), price("US", "2026-05-05", 51)]],
      ["IL", [price("IL", "2026-05-05", 200, "ILS")]],
    ]),
  });
  assert.equal(executionDate, "2026-05-05");
});

test("NAV recomputation uses one current adjusted-price basis after a split revision", () => {
  const nav = computePortfolioNavSeries({
    snapshots: [snapshot({ id: "s1", executionDate: "2026-05-04", ticker: "AAA", entryPrice: 100 })],
    priceBySymbol: new Map([["AAA", [
      price("AAA", "2026-05-04", 50),
      price("AAA", "2026-05-05", 55),
    ]]]),
    benchmarkPoints: [
      price("^SP500TR", "2026-05-04", 200),
      price("^SP500TR", "2026-05-05", 202),
    ],
  });
  assert.equal(nav[0].nav, 100);
  assert.ok(Math.abs(nav[1].nav - 110) < 1e-9);
});
