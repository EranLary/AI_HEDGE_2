import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPayload } from "./dashboard-types";
import {
  prepareDiscoveryUniverse,
  rankDiscoveryRows,
  scoreDiscoveryCandidates,
  selectPositiveTopN,
  type DiscoverySourceReport,
  type ScoredDiscoveryCandidate,
} from "./discovery-engine";

function payload(ticker: string, target: number, allocationPct: number): DashboardPayload {
  return {
    ticker,
    header: { company_name: `${ticker} Corp` },
    valuation_hub: {
      consensus: { current_price: 100, mean_target_price: target, cv: 0 },
      method_tabs: [{
        name: "DCF",
        target_price: target + 10,
        investment_amount: 10_000,
        key_metric_means: {},
        outputs: [{
          output_id: 1,
          persona: "Warren Buffett",
          target_price: target + 5,
          investment_amount: 8_000,
          key_numeric_values: [],
          reason_sections: [],
        }],
      }],
      method_blocks: [],
      all_values: { metric_means: [], source_values: [] },
    },
    decision_card: {
      action: "BUY",
      position_size_pct_of_notional: allocationPct,
      mean_investment_amount: allocationPct * 1_000,
      rationale: "",
    },
    red_flag_shield: [],
    analysis_matrix: {
      executive_summary_markdown: "",
      key_insights: [],
      bull_insights: [],
      red_flag_insights: [],
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
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

test("historical discovery excludes future reports and anchors the 90-day window to as-of", () => {
  const asOfMs = Date.parse("2026-08-01T23:59:59Z");
  const reports: DiscoverySourceReport[] = [
    { ticker: "AAA", generatedAt: "2026-04-01T12:00:00Z", payload: payload("AAA", 110, 5), reportId: "old" },
    { ticker: "AAA", generatedAt: "2026-07-01T12:00:00Z", payload: payload("AAA", 120, 10), reportId: "visible" },
    { ticker: "AAA", generatedAt: "2026-08-02T00:00:00Z", payload: payload("AAA", 300, 50), reportId: "future" },
  ];
  const universe = prepareDiscoveryUniverse({
    reports,
    priceByTicker: new Map([["AAA", 100]]),
    asOfMs,
  });
  assert.equal(universe.tickers.length, 1);
  assert.equal(universe.tickers[0].summary.coverage.reports_in_window, 1);
  assert.deepEqual(universe.tickers[0].sourceReportIds, ["visible"]);

  const overall = scoreDiscoveryCandidates(universe, { type: "overall", key: null, label: "Overall" });
  assert.equal(overall.length, 1);
  assert.ok(Math.abs(Number(overall[0].row.points_score) - 16) < 1e-9);

  assert.deepEqual(universe.models, ["Scenario DCF"]);
  const model = scoreDiscoveryCandidates(universe, { type: "model", key: "Scenario DCF", label: "Scenario DCF" });
  assert.ok(Math.abs(Number(model[0].row.points_score) - 22) < 1e-9);

  const persona = scoreDiscoveryCandidates(universe, { type: "valuator", key: "Warren Buffett", label: "Warren Buffett" });
  assert.ok(Math.abs(Number(persona[0].row.points_score) - 18.2) < 1e-9);
});

function candidate(ticker: string, score: number, disagreement: number = 0): ScoredDiscoveryCandidate {
  return {
    sourceReportIds: [],
    row: {
      ticker,
      company_name: ticker,
      margin_safety_pct: 0,
      overvaluation_pct: 0,
      dispersion: disagreement,
      return_pct: 0,
      investment_allocation_pct: 0,
      confidence_cv: disagreement,
      points_score: score,
      updated_at: "2026-08-01T00:00:00Z",
    },
  };
}

test("Top N keeps only positive scores and uses ticker as a deterministic tie-breaker", () => {
  const selected = selectPositiveTopN([
    candidate("ZZZ", 5),
    candidate("AAA", 5),
    candidate("NEG", -1),
    candidate("ZERO", 0),
  ], 20);
  assert.deepEqual(selected.map((item) => item.row.ticker), ["AAA", "ZZZ"]);
});

test("conviction rankings order ticker-level disagreement in both directions", () => {
  const ranked = rankDiscoveryRows([
    candidate("HIGH", 1, 0.8),
    candidate("LOW", 1, 0.1),
    candidate("MID", 1, 0.4),
    candidate("MISSING", 1, Number.POSITIVE_INFINITY),
  ]);

  assert.deepEqual(ranked.topConviction.map((row) => row.ticker), ["LOW", "MID", "HIGH"]);
  assert.deepEqual(ranked.lowestConviction.map((row) => row.ticker), ["HIGH", "MID", "LOW"]);
});
