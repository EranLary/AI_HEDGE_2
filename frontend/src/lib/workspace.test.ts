import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkspace,
  parseApiWorkspace,
  withWorkspaceQuery,
  workspaceFromPathname,
  workspacePath,
} from "./workspace";

test("legacy API calls default to Analysis while explicit Nasdaq stays isolated", () => {
  assert.equal(parseWorkspace(undefined), "analysis");
  assert.equal(parseWorkspace("analysis"), "analysis");
  assert.equal(parseWorkspace("nasdaq100"), "nasdaq100");
  assert.equal(parseApiWorkspace(undefined), "analysis");
  assert.equal(parseApiWorkspace("nasdaq100"), "nasdaq100");
  assert.equal(parseApiWorkspace("nasdaq-100"), null);
  assert.equal(withWorkspaceQuery("/api/reports", "analysis"), "/api/reports?workspace=analysis");
  assert.equal(withWorkspaceQuery("/api/reports?tab=mine", "nasdaq100"), "/api/reports?tab=mine&workspace=nasdaq100");
});

test("canonical workspace paths preserve the page without sharing report IDs", () => {
  assert.equal(workspacePath("analysis", "/reports"), "/analysis/reports");
  assert.equal(workspacePath("nasdaq100", "/discovery"), "/nasdaq100/discovery");
  assert.equal(workspaceFromPathname("/nasdaq100/dashboard/AAPL/summary"), "nasdaq100");
  assert.equal(workspaceFromPathname("/analysis/dashboard/AAPL/summary"), "analysis");
});
