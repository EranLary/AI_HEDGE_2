import assert from "node:assert/strict";
import test from "node:test";

import { planPaperCutoffs } from "./portfolio-refresh-policy";

test("an explicit Paper cutoff can repair a partially initialized track", () => {
  assert.deepEqual(planPaperCutoffs({
    explicitCutoff: "2026-08-17",
    existingCutoffDates: ["2026-08-18"],
    defaultInitialCutoff: "2026-08-19",
    newMonthlyCutoffs: [],
  }), ["2026-08-17"]);
});

test("a new Paper track uses the safe initial cutoff", () => {
  assert.deepEqual(planPaperCutoffs({
    explicitCutoff: null,
    existingCutoffDates: [],
    defaultInitialCutoff: "2026-08-18",
    newMonthlyCutoffs: [],
  }), ["2026-08-18"]);
});

test("ongoing Paper refreshes retry existing cutoffs and add new month ends", () => {
  assert.deepEqual(planPaperCutoffs({
    explicitCutoff: null,
    existingCutoffDates: ["2026-08-18", "2026-07-31"],
    defaultInitialCutoff: "2026-08-19",
    newMonthlyCutoffs: ["2026-08-31", "2026-08-31"],
  }), ["2026-07-31", "2026-08-18", "2026-08-31"]);
});
