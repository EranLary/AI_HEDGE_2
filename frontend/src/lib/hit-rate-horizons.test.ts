import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPayload } from "./dashboard-types";
import { computeHitRateAggregation, type HitRateMode } from "./hit-rate-aggregate";
import { computeHorizonAccuracy, type HistoricalPricePoint, type HorizonSourceReport } from "./hit-rate-horizons";

function payload(targetPrice = 120, technicalDecision: "bullish" | "bearish" | "neutral" = "bullish"): DashboardPayload {
  return {
    ticker: "TEST",
    header: {},
    red_flag_shield: [],
    analysis_matrix: {
      executive_summary_markdown: "",
      key_insights: [],
      bull_insights: [],
      red_flag_insights: [],
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    },
    valuation_hub: {
      method_blocks: [],
      method_tabs: [{
        name: "DCF",
        target_price: targetPrice,
        investment_amount: 10_000,
        key_metric_means: {},
        outputs: [],
      }],
      consensus: { current_price: 100, mean_target_price: null },
    },
    dream_team: [],
    forecast_forensic_matrix: {
      current_revenue: null,
      target_revenue: null,
      current_earnings: null,
      target_earnings: null,
      forensic_flags: [],
    },
    decision_card: {
      action: "",
      position_size_pct_of_notional: 0,
      mean_investment_amount: null,
      rationale: "",
    },
    technical_analysis: {
      status: "success",
      analysis: { final_decision: technicalDecision },
    },
    artifacts: {},
  };
}

function report(
  reportPayload = payload(),
  availableAt = "2025-01-01T12:00:00Z",
): HorizonSourceReport {
  return {
    ticker: "TEST",
    generatedAt: availableAt,
    availableAt,
    payload: reportPayload,
  };
}

const prices: HistoricalPricePoint[] = [
  { date: "2025-01-01", close: 50, split_factor: 0.5 },
  { date: "2025-01-02", close: 55, split_factor: 1 },
  { date: "2025-01-08", close: 45, split_factor: 1 },
  { date: "2025-01-31", close: 60, split_factor: 1 },
  { date: "2025-04-02", close: 40, split_factor: 1 },
  { date: "2025-07-02", close: 70, split_factor: 1 },
  { date: "2026-01-02", close: 40, split_factor: 1 },
  { date: "2028-01-03", close: 80, split_factor: 1 },
  { date: "2030-01-02", close: 90, split_factor: 1 },
];

test("technical calls use a split-only-adjusted basis for fixed horizons and current", () => {
  const result = computeHorizonAccuracy(
    [report()],
    new Map([["TEST", prices]]),
    new Map([["TEST", 90]]),
    "all",
    new Date("2030-02-01T00:00:00Z"),
  );

  assert.deepEqual(
    result.technical.by_horizon.map((row) => [row.horizon, row.hits, row.misses]),
    [
      ["1d", 1, 0],
      ["1w", 0, 1],
      ["1m", 1, 0],
      ["3m", 0, 1],
      ["current", 1, 0],
    ],
  );
});

test("fundamental targets use the same split-only-adjusted basis at every horizon", () => {
  const result = computeHorizonAccuracy(
    [report()],
    new Map([["TEST", prices]]),
    new Map([["TEST", 90]]),
    "all",
    new Date("2030-02-01T00:00:00Z"),
  );

  assert.deepEqual(
    result.fundamental.by_horizon.map((row) => [row.horizon, row.hits, row.misses]),
    [
      ["6m", 1, 0],
      ["1y", 0, 1],
      ["3y", 1, 0],
      ["5y", 1, 0],
      ["current", 1, 0],
    ],
  );
  assert.equal(result.fundamental.by_model[0].key, "Scenario DCF");
});

test("current horizon matches split-adjusted legacy target and signal hit rates", () => {
  const sourceReport = report();
  const livePrices = new Map<string, number | null>([["TEST", 90]]);
  const historicalPrices = new Map([["TEST", prices]]);

  for (const mode of ["all", "positive_only"] satisfies HitRateMode[]) {
    const horizons = computeHorizonAccuracy(
      [sourceReport],
      historicalPrices,
      livePrices,
      mode,
      new Date("2030-02-01T00:00:00Z"),
    );
    const legacy = computeHitRateAggregation([sourceReport], livePrices, mode, historicalPrices);
    const currentTarget = horizons.fundamental.by_model[0]?.by_horizon.find((row) => row.horizon === "current");
    const currentSignal = horizons.technical.by_horizon.find((row) => row.horizon === "current");
    const legacyTarget = legacy.by_model[0]?.targets;
    const legacySignal = legacy.by_signal[0]?.signals;

    assert.ok(currentTarget && currentSignal && legacyTarget && legacySignal);
    assert.deepEqual(
      [currentTarget.hits, currentTarget.misses, currentTarget.neutral, currentTarget.considered],
      [legacyTarget.hits, legacyTarget.misses, legacyTarget.neutral, legacyTarget.considered],
    );
    assert.deepEqual(
      [currentSignal.hits, currentSignal.misses, currentSignal.neutral, currentSignal.considered],
      [legacySignal.hits, legacySignal.misses, legacySignal.neutral, legacySignal.considered],
    );
  }
});

test("current remains evaluable when a zero saved quote makes fixed horizons unavailable", () => {
  const zeroBaselinePayload = payload();
  zeroBaselinePayload.valuation_hub!.consensus!.current_price = 0;
  const sourceReport = report(zeroBaselinePayload);
  const livePrices = new Map<string, number | null>([["TEST", 10]]);
  const historicalPrices = new Map([["TEST", prices]]);

  const horizons = computeHorizonAccuracy(
    [sourceReport],
    historicalPrices,
    livePrices,
    "all",
    new Date("2030-02-01T00:00:00Z"),
  );
  const legacy = computeHitRateAggregation([sourceReport], livePrices, "all", historicalPrices);
  const current = horizons.fundamental.by_model[0]?.by_horizon.find((row) => row.horizon === "current");
  const fixed = horizons.fundamental.by_model[0]?.by_horizon.find((row) => row.horizon === "6m");
  const legacyTarget = legacy.by_model[0]?.targets;

  assert.ok(current && fixed && legacyTarget);
  assert.equal(current.hits, legacyTarget.hits);
  assert.equal(current.misses, legacyTarget.misses);
  assert.equal(current.considered, legacyTarget.considered);
  assert.equal(fixed.unavailable, 1);
});

test("current matches legacy when the live quote is zero", () => {
  const sourceReport = report();
  const livePrices = new Map<string, number | null>([["TEST", 0]]);
  const historicalPrices = new Map([["TEST", prices]]);

  const horizons = computeHorizonAccuracy(
    [sourceReport],
    historicalPrices,
    livePrices,
    "all",
    new Date("2030-02-01T00:00:00Z"),
  );
  const legacy = computeHitRateAggregation([sourceReport], livePrices, "all", historicalPrices);
  const currentTarget = horizons.fundamental.by_model[0]?.by_horizon.find((row) => row.horizon === "current");
  const currentSignal = horizons.technical.by_horizon.find((row) => row.horizon === "current");
  const legacyTarget = legacy.by_model[0]?.targets;
  const legacySignal = legacy.by_signal[0]?.signals;

  assert.ok(currentTarget && currentSignal && legacyTarget && legacySignal);
  assert.deepEqual(
    [currentTarget.hits, currentTarget.misses, currentTarget.neutral, currentTarget.considered],
    [legacyTarget.hits, legacyTarget.misses, legacyTarget.neutral, legacyTarget.considered],
  );
  assert.deepEqual(
    [currentSignal.hits, currentSignal.misses, currentSignal.neutral, currentSignal.considered],
    [legacySignal.hits, legacySignal.misses, legacySignal.neutral, legacySignal.considered],
  );
});

test("unmatured fixed horizons are pending and excluded from hit rate", () => {
  const recentPrices: HistoricalPricePoint[] = [
    { date: "2029-10-01", close: 100, split_factor: 1 },
    { date: "2030-02-01", close: 110, split_factor: 1 },
  ];
  const result = computeHorizonAccuracy(
    [report(payload(), "2029-10-01T12:00:00Z")],
    new Map([["TEST", recentPrices]]),
    new Map([["TEST", 110]]),
    "all",
    new Date("2030-02-01T00:00:00Z"),
  );

  const sixMonths = result.fundamental.by_horizon.find((row) => row.horizon === "6m");
  const current = result.fundamental.by_horizon.find((row) => row.horizon === "current");
  assert.ok(sixMonths && current);
  assert.equal(sixMonths.pending, 1);
  assert.equal(sixMonths.considered, 0);
  assert.equal(sixMonths.hit_rate_pct, null);
  assert.equal(current.hits, 1);
});

test("a horizon landing today remains pending even when the provider exposes a partial row", () => {
  const sameDayPrices: HistoricalPricePoint[] = [
    { date: "2025-01-01", close: 100, split_factor: 1 },
    { date: "2025-01-02", close: 110, split_factor: 1 },
  ];
  const result = computeHorizonAccuracy(
    [report()],
    new Map([["TEST", sameDayPrices]]),
    new Map([["TEST", 110]]),
    "all",
    new Date("2025-01-02T20:00:00Z"),
  );

  const oneDay = result.technical.by_horizon.find((row) => row.horizon === "1d");
  assert.equal(oneDay?.pending, 1);
  assert.equal(oneDay?.considered, 0);
});

test("positive-only filters downside valuation targets and bearish technical calls", () => {
  const bearishPayload = payload(80, "bearish");
  const result = computeHorizonAccuracy(
    [report(bearishPayload)],
    new Map([["TEST", [{ date: "2025-01-01", close: 100, split_factor: 1 }]]]),
    new Map([["TEST", 90]]),
    "positive_only",
    new Date("2025-02-01T00:00:00Z"),
  );

  const technicalCurrent = result.technical.by_horizon.find((row) => row.horizon === "current");
  const fundamentalCurrent = result.fundamental.by_horizon.find((row) => row.horizon === "current");
  assert.equal(technicalCurrent?.predictions, 0);
  assert.equal(fundamentalCurrent?.predictions, 0);
  assert.equal(result.fundamental.by_model.length, 0);
});

test("positive-only keeps bullish technical calls", () => {
  const result = computeHorizonAccuracy(
    [report(payload(80, "bullish"))],
    new Map([["TEST", [{ date: "2025-01-01", close: 100, split_factor: 1 }]]]),
    new Map([["TEST", 110]]),
    "positive_only",
    new Date("2025-02-01T00:00:00Z"),
  );

  const technicalCurrent = result.technical.by_horizon.find((row) => row.horizon === "current");
  assert.equal(technicalCurrent?.hits, 1);
  assert.equal(technicalCurrent?.predictions, 1);
});
