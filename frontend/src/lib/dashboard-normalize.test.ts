import assert from "node:assert/strict";
import test from "node:test";

import { normalizePayload } from "./dashboard-normalize";
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
});
