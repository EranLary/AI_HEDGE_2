import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPayload } from "./dashboard-types";
import { computeHitRateAggregation, type HitRateSourceReport } from "./hit-rate-aggregate";

function basePayload(): DashboardPayload {
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
      method_tabs: [],
      consensus: {
        current_price: 100,
        mean_target_price: null,
      },
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
    artifacts: {},
  };
}

test("Overall model uses dashboard mean target and mean investment with correct hit-rate math", () => {
  const payload = basePayload();
  payload.valuation_hub.method_tabs = [
    {
      name: "DCF",
      target_price: 130,
      investment_amount: 10000,
      key_metric_means: {},
      outputs: [],
    },
  ];
  payload.valuation_hub.consensus.mean_target_price = 80;
  payload.decision_card.mean_investment_amount = -5000;

  const reports: HitRateSourceReport[] = [{ ticker: "TEST", payload }];
  const live = new Map<string, number | null>([["TEST", 120]]); // actual direction is up vs baseline 100

  const agg = computeHitRateAggregation(reports, live);
  const overall = agg.by_model.find((row) => row.key === "Overall");
  assert.ok(overall);

  // Mean target 80 vs baseline 100 predicts down -> miss against actual up.
  assert.equal(overall.targets.hits, 0);
  assert.equal(overall.targets.misses, 1);
  assert.equal(overall.targets.neutral, 0);
  assert.equal(overall.targets.considered, 1);
  assert.equal(overall.targets.hit_rate_pct, 0);

  // Mean investment -5000 predicts down allocation -> miss against actual up.
  assert.equal(overall.allocations.hits, 0);
  assert.equal(overall.allocations.misses, 1);
  assert.equal(overall.allocations.neutral, 0);
  assert.equal(overall.allocations.considered, 1);
  assert.equal(overall.allocations.hit_rate_pct, 0);
});

test("Overall target < 0 is floored to 0 and neutral allocations are excluded from denominator", () => {
  const payload = basePayload();
  payload.valuation_hub.consensus.mean_target_price = -10; // floored to 0, still predicts down vs baseline 100
  payload.decision_card.mean_investment_amount = 0; // neutral allocation verdict

  const reports: HitRateSourceReport[] = [{ ticker: "TEST", payload }];
  const live = new Map<string, number | null>([["TEST", 90]]); // actual direction is down

  const agg = computeHitRateAggregation(reports, live);
  const overall = agg.by_model.find((row) => row.key === "Overall");
  assert.ok(overall);

  assert.equal(overall.targets.hits, 1);
  assert.equal(overall.targets.misses, 0);
  assert.equal(overall.targets.considered, 1);
  assert.equal(overall.targets.hit_rate_pct, 100);

  assert.equal(overall.allocations.hits, 0);
  assert.equal(overall.allocations.misses, 0);
  assert.equal(overall.allocations.neutral, 1);
  assert.equal(overall.allocations.considered, 0);
  assert.equal(overall.allocations.hit_rate_pct, null);
});

test("positive_only mode counts only positive target/allocation predictions", () => {
  const payload = basePayload();
  payload.valuation_hub.method_tabs = [
    {
      name: "DCF",
      target_price: 130, // positive prediction vs baseline 100
      investment_amount: -5000, // negative allocation prediction -> excluded in positive_only mode
      key_metric_means: {},
      outputs: [],
    },
  ];

  const reports: HitRateSourceReport[] = [{ ticker: "TEST", payload }];
  const live = new Map<string, number | null>([["TEST", 120]]); // actual up

  const agg = computeHitRateAggregation(reports, live, "positive_only");
  const dcf = agg.by_model.find((row) => row.key === "Scenario DCF");
  assert.ok(dcf);

  // Only positive target prediction should be counted -> hit.
  assert.equal(dcf.targets.hits, 1);
  assert.equal(dcf.targets.misses, 0);
  assert.equal(dcf.targets.considered, 1);
  assert.equal(dcf.targets.hit_rate_pct, 100);

  // Negative allocation prediction is excluded completely in positive-only mode.
  assert.equal(dcf.allocations.hits, 0);
  assert.equal(dcf.allocations.misses, 0);
  assert.equal(dcf.allocations.neutral, 0);
  assert.equal(dcf.allocations.considered, 0);
  assert.equal(dcf.allocations.hit_rate_pct, null);
});

test("technical analysis bearish signal hits when price direction moves down", () => {
  const payload = basePayload();
  payload.technical_analysis = {
    status: "success",
    analysis: {
      final_decision: "bearish",
      bullish_probability: 0.3,
      bearish_probability: 0.7,
    },
  };

  const reports: HitRateSourceReport[] = [{ ticker: "TEST", payload }];
  const live = new Map<string, number | null>([["TEST", 90]]); // actual direction is down

  const agg = computeHitRateAggregation(reports, live);
  const technical = agg.by_model.find((row) => row.key === "Technical Analysis");
  assert.ok(technical);

  assert.equal(technical.signals.hits, 1);
  assert.equal(technical.signals.misses, 0);
  assert.equal(technical.signals.neutral, 0);
  assert.equal(technical.signals.considered, 1);
  assert.equal(technical.signals.hit_rate_pct, 100);
  assert.equal(agg.overview.signals.hits, 1);
  assert.equal(agg.overview.combined.hits, 1);
});

test("technical analysis neutral signal has no direction", () => {
  const payload = basePayload();
  payload.technical_analysis = {
    status: "success",
    analysis: {
      final_decision: "neutral",
      bullish_probability: 0.51,
      bearish_probability: 0.49,
    },
  };

  const reports: HitRateSourceReport[] = [{ ticker: "TEST", payload }];
  const live = new Map<string, number | null>([["TEST", 120]]);

  const agg = computeHitRateAggregation(reports, live);
  const technical = agg.by_model.find((row) => row.key === "Technical Analysis");
  assert.ok(technical);

  assert.equal(technical.signals.hits, 0);
  assert.equal(technical.signals.misses, 0);
  assert.equal(technical.signals.neutral, 1);
  assert.equal(technical.signals.considered, 0);
  assert.equal(technical.signals.hit_rate_pct, null);
});

test("technical analysis can derive direction from probabilities", () => {
  const payload = basePayload();
  payload.technical_analysis = {
    status: "success",
    analysis: {
      bullish_probability: 0.8,
      bearish_probability: 0.2,
    },
  };

  const reports: HitRateSourceReport[] = [{ ticker: "TEST", payload }];
  const live = new Map<string, number | null>([["TEST", 90]]); // actual direction is down

  const agg = computeHitRateAggregation(reports, live);
  const technical = agg.by_model.find((row) => row.key === "Technical Analysis");
  assert.ok(technical);

  assert.equal(technical.signals.hits, 0);
  assert.equal(technical.signals.misses, 1);
  assert.equal(technical.signals.considered, 1);
  assert.equal(technical.signals.hit_rate_pct, 0);
});
