import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPayload } from "./dashboard-types";
import { consensusModelViews } from "./consensus-models";

function payload(): DashboardPayload {
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
      consensus: {
        current_price: 100,
        mean_target_price: 120,
        median_target_price: 110,
        sector_weighted_target_price: 130,
        component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
      },
    },
    score_card: {
      position_size_pct_of_notional: 11,
      mean_investment_amount: 11_000,
      mean_investment_amount_raw: 10_000,
      median_investment_amount: 5_000,
      sector_weighted_investment_amount: 20_000,
      mean_score: 12,
      median_score: 8,
      sector_weighted_score: 16,
      allocation_component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
      rationale: "",
    },
    dream_team: [],
    forecast_forensic_matrix: {
      current_revenue: null,
      target_revenue: null,
      current_earnings: null,
      target_earnings: null,
      forensic_flags: [],
    },
    artifacts: {},
  };
}

test("exposes Sector-Weighted, Simple Mean, and Median as independent consensus models", () => {
  const views = consensusModelViews(payload());
  assert.deepEqual(views.map((view) => view.name), [
    "Sector-Weighted Valuation",
    "Simple Mean",
    "Median",
  ]);

  const mean = views.find((view) => view.key === "mean");
  assert.ok(mean);
  assert.equal(mean.targetPrice, 120);
  assert.equal(mean.investmentAmount, 10_000);
  assert.equal(mean.score, 12);
  assert.equal(mean.targetWeight, 0.3);
  assert.equal(mean.allocationWeight, 0.3);
});

test("renormalizes displayed component weights when Median is unavailable", () => {
  const value = payload();
  value.valuation_hub.consensus.median_target_price = null;
  value.score_card!.median_investment_amount = null;

  const views = consensusModelViews(value);
  const mean = views.find((view) => view.key === "mean");
  const median = views.find((view) => view.key === "median");
  const weighted = views.find((view) => view.key === "sector_weighted");

  assert.ok(mean && median && weighted);
  assert.ok(Math.abs(Number(mean.targetWeight) - (3 / 7)) < 1e-12);
  assert.ok(Math.abs(Number(weighted.targetWeight) - (4 / 7)) < 1e-12);
  assert.equal(median.targetWeight, null);
  assert.equal(median.allocationWeight, null);
});
