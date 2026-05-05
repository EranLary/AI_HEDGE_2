import assert from "node:assert/strict";
import test from "node:test";

import {
  actualDirectionFromPrices,
  allocationDirectionFromAmount,
  targetDirectionWithFloor,
  verdictFromDirections,
} from "./hit-rate-utils";

test("verdict: match and mismatch", () => {
  assert.equal(verdictFromDirections(1, 1), "hit");
  assert.equal(verdictFromDirections(-1, -1), "hit");
  assert.equal(verdictFromDirections(1, -1), "miss");
  assert.equal(verdictFromDirections(-1, 1), "miss");
});

test("verdict: neutral actual or predicted yields '-'", () => {
  assert.equal(verdictFromDirections(0, 1), "-");
  assert.equal(verdictFromDirections(1, 0), "-");
  assert.equal(verdictFromDirections(null, 1), "-");
  assert.equal(verdictFromDirections(1, null), "-");
});

test("target direction floors negatives to zero", () => {
  // Baseline 10, target -5 -> floored target 0 -> down direction
  assert.equal(targetDirectionWithFloor(-5, 10), -1);
});

test("allocation zero becomes neutral direction", () => {
  assert.equal(allocationDirectionFromAmount(0), 0);
});

test("actual direction from live vs report price", () => {
  assert.equal(actualDirectionFromPrices(12, 10), 1);
  assert.equal(actualDirectionFromPrices(8, 10), -1);
  assert.equal(actualDirectionFromPrices(10, 10), 0);
});
