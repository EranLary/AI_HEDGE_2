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
        deep_research_target_price: 140,
        component_weights: { mean: 0.24, median: 0.24, sector_weighted: 0.32, deep_research: 0.2 },
      },
    },
    score_card: {
      position_size_pct_of_notional: 11,
      mean_investment_amount: 11_000,
      mean_investment_amount_raw: 10_000,
      median_investment_amount: 5_000,
      sector_weighted_investment_amount: 20_000,
      deep_research_investment_amount: 30_000,
      mean_score: 12,
      median_score: 8,
      sector_weighted_score: 16,
      deep_research_score: 22,
      allocation_component_weights: { mean: 0.24, median: 0.24, sector_weighted: 0.32, deep_research: 0.2 },
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

test("exposes Deep Research as a fourth independent consensus model", () => {
  const views = consensusModelViews(payload());
  assert.deepEqual(views.map((view) => view.name), [
    "Sector-Weighted Valuation",
    "Deep Research",
    "Simple Mean",
    "Median",
  ]);

  const mean = views.find((view) => view.key === "mean");
  assert.ok(mean);
  assert.equal(mean.targetPrice, 120);
  assert.equal(mean.investmentAmount, 10_000);
  assert.equal(mean.score, 12);
  assert.equal(mean.targetWeight, 0.24);
  assert.equal(mean.allocationWeight, 0.24);

  const deep = views.find((view) => view.key === "deep_research");
  assert.ok(deep);
  assert.equal(deep.targetPrice, 140);
  assert.equal(deep.investmentAmount, 30_000);
  assert.equal(deep.score, 22);
  assert.equal(deep.targetWeight, 0.2);
  assert.equal(deep.allocationWeight, 0.2);
});

test("renormalizes displayed component weights when Median is unavailable", () => {
  const value = payload();
  value.valuation_hub.consensus.median_target_price = null;
  value.score_card!.median_investment_amount = null;
  value.valuation_hub.consensus.deep_research_target_price = null;
  value.score_card!.deep_research_investment_amount = null;

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

test("legacy reports without the Deep Research contract retain three consensus views", () => {
  const value = payload();
  delete value.valuation_hub.consensus.deep_research_target_price;
  delete value.valuation_hub.deep_research_valuation;
  delete value.score_card!.deep_research_investment_amount;
  delete value.score_card!.deep_research_score;

  assert.deepEqual(consensusModelViews(value).map((view) => view.name), [
    "Sector-Weighted Valuation",
    "Simple Mean",
    "Median",
  ]);
});
