import assert from "node:assert/strict";
import test from "node:test";

import {
  computeExecutorSignature,
  constantTimeHexEqual,
  executorTimestampIsFresh,
} from "./trading-signature";
import { tradingPortfolioKey } from "./trading-types";

test("executor signatures bind timestamp nonce and exact request body", () => {
  const base = { secret: "device-secret", timestamp: "1800000000", nonce: "unique-nonce", rawBody: "{\"ok\":true}" };
  const signature = computeExecutorSignature(base);
  assert.equal(constantTimeHexEqual(signature, computeExecutorSignature(base)), true);
  assert.notEqual(signature, computeExecutorSignature({ ...base, nonce: "different" }));
  assert.notEqual(signature, computeExecutorSignature({ ...base, rawBody: "{\"ok\":false}" }));
});

test("executor timestamps reject requests outside the five minute window", () => {
  assert.equal(executorTimestampIsFresh("1000", 1300), true);
  assert.equal(executorTimestampIsFresh("999", 1300), false);
  assert.equal(executorTimestampIsFresh("invalid", 1300), false);
});

test("portfolio identity is stable and workspace-isolated", () => {
  const analysis = tradingPortfolioKey({ workspace: "analysis", lensType: "model", lensKey: "Analyst", methodologyVersion: "v1" });
  const nasdaq = tradingPortfolioKey({ workspace: "nasdaq100", lensType: "model", lensKey: "Analyst", methodologyVersion: "v1" });
  assert.equal(analysis, "analysis:model:Analyst:v1");
  assert.notEqual(analysis, nasdaq);
});
