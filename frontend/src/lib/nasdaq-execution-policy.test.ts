import assert from "node:assert/strict";
import test from "node:test";

import { isPreferredNasdaqExecutionWindow } from "./nasdaq-execution-policy";

test("preferred Nasdaq execution window crosses UTC midnight", () => {
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T10:00:00Z")), true);
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T23:59:00Z")), true);
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T00:59:00Z")), true);
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T01:00:00Z")), false);
  assert.equal(isPreferredNasdaqExecutionWindow(new Date("2026-08-21T09:59:00Z")), false);
});
