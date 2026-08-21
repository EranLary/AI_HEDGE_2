import assert from "node:assert/strict";
import test from "node:test";

import { selectNasdaqRunStocks } from "./nasdaq-run-policy";

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

