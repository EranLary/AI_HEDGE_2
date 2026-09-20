import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPayload } from "./dashboard-types";
import { computeScreenerTickerSummary } from "./screener-consensus";

function report(payload: DashboardPayload) {
  return { ticker: "TEST", generatedAt: "2026-09-20T00:00:00Z", payload };
}

test("screener target reconstructs legacy Median before aggregation", () => {
  const legacy = {
    ticker: "TEST",
    header: { current_price: 100 },
    valuation_hub: {
      consensus: { current_price: 100, mean_target_price: 200 },
      prices: {
        Current: 100,
        Overall: [200],
        "Scenario DCF": [100],
        "Target Scenario": [150],
        "Dream Team": [250],
        "Investment Percents": {
          "Scenario DCF": 5,
          "Target Scenario": 10,
          "Dream Team": 20,
        },
      },
    },
    score_card: { position_size_pct_of_notional: 0, mean_investment_amount: null, rationale: "legacy" },
  } as unknown as DashboardPayload;

  const summary = computeScreenerTickerSummary([report(legacy)]);
  assert.equal(summary.overview.mean_target_price, 175);
  assert.ok(Math.abs(Number(summary.overview.mean_allocation_pct) - 10.833333333333332) < 1e-9);
});

test("screener keeps a high Mean-only report when Median is unavailable", () => {
  const meanOnly = {
    ticker: "TEST",
    header: { current_price: 100 },
    valuation_hub: {
      consensus: { current_price: 100, mean_target_price: 180 },
      prices: { Current: 100, Overall: [180], "Scenario DCF": [180], "LMIL Mean Investment": 15000 },
    },
    score_card: { position_size_pct_of_notional: 15, mean_investment_amount: 15000, rationale: "legacy" },
  } as unknown as DashboardPayload;

  const summary = computeScreenerTickerSummary([report(meanOnly)]);
  assert.equal(summary.overview.mean_target_price, 180);
  assert.equal(summary.overview.mean_allocation_pct, 15);
  assert.equal(summary.coverage.reports_in_window, 1);
});
