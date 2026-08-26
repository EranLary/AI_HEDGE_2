import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../app/api/portfolio-performance/route";

test("Nasdaq 100 Backtest API requests are rejected before data access", async () => {
  const response = await GET(new Request(
    "http://localhost/api/portfolio-performance?workspace=nasdaq100&track=backtest&methodology=equal",
  ));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Nasdaq 100 portfolio tracking supports Paper only; Backtest is available in Analysis.",
  });
});
