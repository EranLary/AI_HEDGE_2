import assert from "node:assert/strict";
import test from "node:test";

import { targetPriceTone } from "./target-price-comparison";

test("marks targets above and below the current price", () => {
  assert.equal(targetPriceTone(59.54, 51.55), "positive");
  assert.equal(targetPriceTone(48.25, 51.55), "negative");
});

test("keeps equal or unavailable comparisons neutral", () => {
  assert.equal(targetPriceTone(51.55, 51.55), "neutral");
  assert.equal(targetPriceTone(null, 51.55), "neutral");
  assert.equal(targetPriceTone(59.54, null), "neutral");
});
