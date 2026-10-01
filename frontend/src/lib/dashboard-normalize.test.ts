import assert from "node:assert/strict";
import test from "node:test";

import { normalizePayload, normalizeValuationConsensus } from "./dashboard-normalize";
import type { DashboardPayload } from "./dashboard-types";

test("legacy reports reconstruct Median from independent method families without copying Mean", () => {
  const legacy = {
    ticker: "TEST",
    header: { current_price: 100 },
    valuation_hub: {
      consensus: { current_price: 100, mean_target_price: 233.3333333333 },
      prices: {
        Current: 100,
        Overall: [233.3333333333, 100, 400],
        "Scenario DCF": [100],
        "Target Scenario": [200],
        "Dream Team": [400],
        "Investment Percents": {
          "Scenario DCF": -10,
          "Target Scenario": 5,
          "Dream Team": 20,
        },
      },
    },
    score_card: { position_size_pct_of_notional: 0, mean_investment_amount: null, rationale: "legacy" },
  } as unknown as DashboardPayload;

  const normalized = normalizePayload("TEST", legacy);
  const consensus = normalized.valuation_hub.consensus;
  const card = normalized.score_card!;

  assert.equal(consensus.mean_target_price, 233.3333333333);
  assert.equal(consensus.median_target_price, 200);
  assert.equal(consensus.decision_target_price, (233.3333333333 + 200) / 2);
  assert.equal(card.mean_investment_amount_raw, 5000);
  assert.equal(card.median_investment_amount, 5000);
  assert.equal(card.decision_investment_amount, 5000);
  assert.equal(consensus.consensus_basis, "mean_median");
  assert.equal(card.consensus_basis, "mean_median");
});

test("a legacy report without two independent families leaves Median unavailable", () => {
  const legacy = {
    ticker: "TEST",
    valuation_hub: {
      consensus: { current_price: 100, mean_target_price: 120 },
      prices: { Current: 100, Overall: [120], "Scenario DCF": [120] },
    },
    score_card: { position_size_pct_of_notional: 0, mean_investment_amount: null, rationale: "legacy" },
  } as unknown as DashboardPayload;

  const normalized = normalizePayload("TEST", legacy);
  assert.equal(normalized.valuation_hub.consensus.median_target_price, null);
  assert.notEqual(normalized.valuation_hub.consensus.median_target_price, normalized.valuation_hub.consensus.mean_target_price);
  assert.equal(normalized.valuation_hub.consensus.decision_target_price, 120);
  assert.equal(normalized.score_card?.median_score, null);
  assert.equal(normalized.score_card?.consensus_basis, "mean_only");
});

test("missing allocation makes the whole decision fall back to Mean even when a median target exists", () => {
  const payload = {
    ticker: "TEST",
    header: { current_price: 100 },
    valuation_hub: {
      consensus: { current_price: 100, mean_target_price: 140, median_target_price: 120, decision_target_price: 130 },
      prices: { Current: 100, Mean: [140], Median: [120], "LMIL Mean Investment": 10000 },
    },
    score_card: {
      position_size_pct_of_notional: 7.5,
      mean_investment_amount: 7500,
      mean_investment_amount_raw: 10000,
      median_investment_amount: null,
      decision_investment_amount: 7500,
      adjusted_score: 99,
      rationale: "old decision",
    },
  } as unknown as DashboardPayload;

  const normalized = normalizeValuationConsensus(payload);
  assert.equal(normalized.valuation_hub.consensus.median_target_price, null);
  assert.equal(normalized.valuation_hub.consensus.decision_target_price, 140);
  assert.equal(normalized.score_card?.decision_investment_amount, 10000);
  assert.equal(normalized.score_card?.position_size_pct_of_notional, 10);
  assert.equal(normalized.score_card?.median_score, null);
  assert.equal(normalized.score_card?.consensus_basis, "mean_only");
});

test("sector-weighted-v1 consensus is preserved without leaking the derived row into Mean or Median", () => {
  const payload = {
    ticker: "TEST",
    header: { current_price: 100 },
    valuation_hub: {
      method_blocks: [
        { name: "Scenario DCF", target_price: 120, investment_amount: 10000 },
        { name: "Sector-Weighted Valuation", target_price: 150, investment_amount: 20000 },
      ],
      method_tabs: [],
      sector_weighted_valuation: { policy_version: "sector-weighted-v1", target_price: 150 },
      consensus: {
        current_price: 100,
        mean_target_price: 120,
        median_target_price: 110,
        sector_weighted_target_price: 150,
        decision_target_price: 129,
        consensus_basis: "mean_median_sector_weighted",
        component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
      },
    },
    score_card: {
      position_size_pct_of_notional: 15,
      mean_investment_amount: 15000,
      mean_investment_amount_raw: 10000,
      median_investment_amount: 12000,
      decision_investment_amount: 15000,
      consensus_basis: "mean_median_sector_weighted",
      adjusted_score: 20,
      rationale: "weighted",
    },
  } as unknown as DashboardPayload;

  const normalized = normalizeValuationConsensus(payload);
  assert.equal(normalized.valuation_hub.consensus.mean_target_price, 120);
  assert.equal(normalized.valuation_hub.consensus.median_target_price, 110);
  assert.equal(normalized.valuation_hub.consensus.decision_target_price, 129);
  assert.equal(normalized.score_card?.adjusted_score, 20);
});
