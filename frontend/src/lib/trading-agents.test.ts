import assert from "node:assert/strict";
import test from "node:test";

import { tradingAgentsDecisionTone, tradingAgentsDisplayDecision } from "./trading-agents";

test("uses the structured rating before words in the decision prose", () => {
  const decision = `
## Final Trading Decision - IBM

**Rating: Underweight**

IBM's dividend yield is not a reason to buy. Execute a staged sell into strength.
`;

  assert.equal(tradingAgentsDecisionTone("Underweight", decision), "down");
});

test("reads an explicit rating header for existing verbose v3 reports", () => {
  const decision = "**Rating: Underweight**\nThis is not a reason to buy.";

  assert.equal(tradingAgentsDecisionTone(undefined, decision), "down");
});

test("does not infer tone from incidental recommendation words", () => {
  assert.equal(tradingAgentsDecisionTone(undefined, "This is not a reason to buy."), "neutral");
});

test("keeps compact legacy decisions working", () => {
  assert.equal(tradingAgentsDecisionTone(undefined, "Overweight"), "up");
  assert.equal(tradingAgentsDecisionTone(undefined, "Hold"), "neutral");
});

test("uses the structured rating as the compact decision for verbose v3 reports", () => {
  assert.equal(
    tradingAgentsDisplayDecision("Underweight", "**Rating: Underweight**\nLong Portfolio Manager transcript."),
    "Underweight",
  );
});
