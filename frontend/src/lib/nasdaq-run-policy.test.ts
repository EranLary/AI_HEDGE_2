import assert from "node:assert/strict";
import test from "node:test";

import {
  deduplicateNasdaqIssuerStocks,
  selectNasdaqRunStocks,
  summarizeNasdaqIssuerCoverage,
} from "./nasdaq-run-policy";

const UNIVERSE = [
  { ticker: "AAPL", companyName: "Apple", rank: 1 },
  { ticker: "MSFT", companyName: "Microsoft", rank: 2 },
  { ticker: "NVDA", companyName: "Nvidia", rank: 3 },
];

test("a seven-day resume queues only tickers missing from the interrupted release", () => {
  const stocks = selectNasdaqRunStocks(UNIVERSE, {
    mode: "all",
    resumedReleaseTickers: ["aapl", "NVDA"],
  });
  assert.deepEqual(stocks.map((stock) => stock.ticker), ["MSFT"]);
});

test("missing-week resume skips both release completions and other recent reports", () => {
  const stocks = selectNasdaqRunStocks(UNIVERSE, {
    mode: "missing_week",
    resumedReleaseTickers: ["MSFT"],
    recentlyCompletedTickers: ["aapl"],
  });
  assert.deepEqual(stocks.map((stock) => stock.ticker), ["NVDA"]);
});

test("all-mode resume does not inherit recent reports from other releases", () => {
  const stocks = selectNasdaqRunStocks(UNIVERSE, {
    mode: "all",
    resumedReleaseTickers: ["MSFT"],
    recentlyCompletedTickers: ["aapl"],
  });
  assert.deepEqual(stocks.map((stock) => stock.ticker), ["AAPL", "NVDA"]);
});

test("missing-week mode skips reports completed anywhere in the last seven days", () => {
  const stocks = selectNasdaqRunStocks(UNIVERSE, {
    mode: "missing_week",
    recentlyCompletedTickers: ["MSFT"],
  });
  assert.deepEqual(stocks.map((stock) => stock.ticker), ["AAPL", "NVDA"]);
});

test("selected mode cannot queue symbols outside the Nasdaq universe", () => {
  const stocks = selectNasdaqRunStocks(UNIVERSE, {
    mode: "selected",
    selectedTickers: ["NVDA", "TSLA"],
  });
  assert.deepEqual(stocks.map((stock) => stock.ticker), ["NVDA"]);
});

const ALPHABET_UNIVERSE = [
  { ticker: "GOOGL", companyName: "Alphabet Inc. Class A Common Stock", rank: 5 },
  { ticker: "GOOG", companyName: "Alphabet Inc. Class C Capital Stock", rank: 6 },
  { ticker: "AAPL", companyName: "Apple Inc.", rank: 1 },
];

test("issuer deduplication keeps GOOGL and exposes GOOG only as an alias", () => {
  const stocks = deduplicateNasdaqIssuerStocks(ALPHABET_UNIVERSE);
  assert.deepEqual(stocks.map((stock) => stock.ticker), ["GOOGL", "AAPL"]);
  assert.deepEqual(stocks[0].aliases, ["GOOGL", "GOOG"]);
});

test("all mode never queues both Alphabet share classes", () => {
  const stocks = selectNasdaqRunStocks(ALPHABET_UNIVERSE, { mode: "all" });
  assert.deepEqual(stocks.map((stock) => stock.ticker), ["GOOGL", "AAPL"]);
});

test("selected mode maps either or both Alphabet symbols to GOOGL", () => {
  for (const selectedTickers of [["GOOG"], ["GOOGL"], ["GOOG", "GOOGL"]]) {
    const stocks = selectNasdaqRunStocks(ALPHABET_UNIVERSE, { mode: "selected", selectedTickers });
    assert.deepEqual(stocks.map((stock) => stock.ticker), ["GOOGL"]);
  }
});

test("missing-week and resume modes treat a GOOG report as completed GOOGL coverage", () => {
  const missingWeek = selectNasdaqRunStocks(ALPHABET_UNIVERSE, {
    mode: "missing_week",
    recentlyCompletedTickers: ["GOOG"],
  });
  assert.deepEqual(missingWeek.map((stock) => stock.ticker), ["AAPL"]);

  const resumed = selectNasdaqRunStocks(ALPHABET_UNIVERSE, {
    mode: "all",
    resumedReleaseTickers: ["GOOG"],
  });
  assert.deepEqual(resumed.map((stock) => stock.ticker), ["AAPL"]);
});

test("monthly coverage counts each issuer once and accepts any completed alias", () => {
  assert.deepEqual(
    summarizeNasdaqIssuerCoverage(ALPHABET_UNIVERSE, ["GOOG", "GOOGL", "AAPL", "NOT-IN-UNIVERSE"]),
    { completed: 2, total: 2 },
  );
});

test("future same-issuer share classes collapse to the best-ranked security", () => {
  const stocks = deduplicateNasdaqIssuerStocks([
    { ticker: "TESTB", companyName: "Test Holdings Class B Common Stock", rank: 40 },
    { ticker: "TESTA", companyName: "Test Holdings Class A Common Stock", rank: 39 },
  ]);
  assert.deepEqual(stocks.map((stock) => stock.ticker), ["TESTA"]);
  assert.deepEqual(stocks[0].aliases, ["TESTB", "TESTA"]);
});

