import assert from "node:assert/strict";
import test from "node:test";

import {
  configuredNasdaqBudget,
  isPreferredNasdaqExecutionWindow,
} from "./nasdaq-execution-policy";

test("preferred Nasdaq execution window crosses UTC midnight", () => {
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T10:00:00Z")), true);
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T23:59:00Z")), true);
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T00:59:00Z")), true);
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T01:00:00Z")), false);
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T09:59:00Z")), false);
});

test("Nasdaq universe runs default to a 600 dollar planned budget", () => {
  const previous = process.env.NASDAQ_RUN_BUDGET_USD;
  delete process.env.NASDAQ_RUN_BUDGET_USD;
  try {
    assert.equal(configuredNasdaqBudget(), 600);
  } finally {
    if (previous === undefined) delete process.env.NASDAQ_RUN_BUDGET_USD;
    else process.env.NASDAQ_RUN_BUDGET_USD = previous;
  }
});
