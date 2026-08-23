import assert from "node:assert/strict";
import test from "node:test";

import {
  configuredNasdaqBudget,
  configuredNasdaqConcurrency,
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

test("dedicated Nasdaq runs default to ten concurrent tickers and retain the safety cap", () => {
  const previousWorkerUrl = process.env.NASDAQ_WORKER_URL;
  const previousConcurrency = process.env.NASDAQ_RUN_CONCURRENCY;
  process.env.NASDAQ_WORKER_URL = "https://nasdaq-worker.example";
  delete process.env.NASDAQ_RUN_CONCURRENCY;
  try {
    assert.equal(configuredNasdaqConcurrency(), 10);
    process.env.NASDAQ_RUN_CONCURRENCY = "999";
    assert.equal(configuredNasdaqConcurrency(), 12);
  } finally {
    if (previousWorkerUrl === undefined) delete process.env.NASDAQ_WORKER_URL;
    else process.env.NASDAQ_WORKER_URL = previousWorkerUrl;
    if (previousConcurrency === undefined) delete process.env.NASDAQ_RUN_CONCURRENCY;
    else process.env.NASDAQ_RUN_CONCURRENCY = previousConcurrency;
  }
});
