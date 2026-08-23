import assert from "node:assert/strict";
import test from "node:test";

import { tradingExecutionIdentity } from "./trading-db";

test("IBKR execution corrections share a family and advance the revision", () => {
  assert.deepEqual(tradingExecutionIdentity("0001.01"), { familyId: "0001", revision: 1 });
  assert.deepEqual(tradingExecutionIdentity("0001.02"), { familyId: "0001", revision: 2 });
});

test("execution ids without a correction suffix remain independent", () => {
  assert.deepEqual(tradingExecutionIdentity("paper-fill-a"), { familyId: "paper-fill-a", revision: 0 });
});
