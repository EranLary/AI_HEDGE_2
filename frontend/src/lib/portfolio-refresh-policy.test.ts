import assert from "node:assert/strict";
import test from "node:test";

import {
  latestExpectedPortfolioRefreshAt,
  planPaperCutoffs,
  portfolioRefreshHealth,
  runPortfolioRefreshTasksIndependently,
  type PortfolioRefreshRunSummary,
} from "./portfolio-refresh-policy";

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

test("a new full-universe Paper track starts after its final report date", () => {
  assert.deepEqual(planPaperCutoffs({
    explicitCutoff: null,
    existingCutoffDates: [],
    defaultInitialCutoff: "2026-08-23",
    completedUniverseCutoff: "2026-08-24",
    newMonthlyCutoffs: [],
  }), ["2026-08-24"]);
});

test("a methodology launch cutoff prevents a new Paper track from being backdated", () => {
  assert.deepEqual(planPaperCutoffs({
    explicitCutoff: null,
    existingCutoffDates: [],
    defaultInitialCutoff: "2026-08-25",
    completedUniverseCutoff: "2026-08-24",
    methodologyLaunchCutoff: "2026-08-25",
    newMonthlyCutoffs: [],
  }), ["2026-08-25"]);
});

test("complete-universe coverage remains the floor when it follows methodology launch", () => {
  assert.deepEqual(planPaperCutoffs({
    explicitCutoff: null,
    existingCutoffDates: [],
    defaultInitialCutoff: "2026-08-25",
    completedUniverseCutoff: "2026-08-27",
    methodologyLaunchCutoff: "2026-08-25",
    newMonthlyCutoffs: [],
  }), ["2026-08-27"]);
});

test("an explicit Paper cutoff cannot predate methodology launch", () => {
  assert.throws(() => planPaperCutoffs({
    explicitCutoff: "2026-08-24",
    existingCutoffDates: [],
    defaultInitialCutoff: "2026-08-25",
    methodologyLaunchCutoff: "2026-08-25",
    newMonthlyCutoffs: [],
  }), /predates methodology launch cutoff 2026-08-25/);
});

test("ongoing Paper refreshes retry existing cutoffs and add new month ends", () => {
  assert.deepEqual(planPaperCutoffs({
    explicitCutoff: null,
    existingCutoffDates: ["2026-08-18", "2026-07-31"],
    defaultInitialCutoff: "2026-08-19",
    newMonthlyCutoffs: ["2026-08-31", "2026-08-31"],
  }), ["2026-07-31", "2026-08-18", "2026-08-31"]);
});

function refreshSummary(overrides: Partial<PortfolioRefreshRunSummary> = {}): PortfolioRefreshRunSummary {
  return {
    latestStatus: "completed",
    latestStartedAt: "2026-08-26T01:30:00.000Z",
    latestFinishedAt: "2026-08-26T02:00:00.000Z",
    lastSuccessfulAt: "2026-08-26T02:00:00.000Z",
    lastUsableAt: "2026-08-26T02:00:00.000Z",
    providerWarningCount: 0,
    ...overrides,
  };
}

test("freshness schedule waits for grace and skips Sunday and Monday", () => {
  assert.equal(
    latestExpectedPortfolioRefreshAt(new Date("2026-08-26T05:00:00.000Z")),
    "2026-08-25T01:30:00.000Z",
  );
  assert.equal(
    latestExpectedPortfolioRefreshAt(new Date("2026-08-26T08:00:00.000Z")),
    "2026-08-26T01:30:00.000Z",
  );
  assert.equal(
    latestExpectedPortfolioRefreshAt(new Date("2026-08-31T12:00:00.000Z")),
    "2026-08-29T01:30:00.000Z",
  );
});

test("refresh health distinguishes fresh partial failed running stale and missing", () => {
  const now = new Date("2026-08-26T08:00:00.000Z");
  assert.equal(portfolioRefreshHealth(refreshSummary(), now).state, "fresh");
  assert.equal(portfolioRefreshHealth(refreshSummary({
    latestStatus: "partial",
    lastSuccessfulAt: "2026-08-25T02:00:00.000Z",
    providerWarningCount: 2,
  }), now).state, "partial");
  assert.equal(portfolioRefreshHealth(refreshSummary({
    latestStatus: "failed",
    latestStartedAt: "2026-08-26T03:00:00.000Z",
    latestFinishedAt: "2026-08-26T03:05:00.000Z",
    lastSuccessfulAt: "2026-08-26T02:00:00.000Z",
    lastUsableAt: "2026-08-26T02:00:00.000Z",
  }), now).state, "failed");
  assert.equal(portfolioRefreshHealth(refreshSummary({
    latestStatus: "running",
    latestStartedAt: "2026-08-26T07:00:00.000Z",
    latestFinishedAt: null,
    lastSuccessfulAt: "2026-08-26T02:00:00.000Z",
    lastUsableAt: "2026-08-26T02:00:00.000Z",
  }), now).state, "running");
  assert.equal(portfolioRefreshHealth(refreshSummary({
    latestStatus: "running",
    latestStartedAt: "2026-08-26T03:00:00.000Z",
    latestFinishedAt: null,
    lastSuccessfulAt: "2026-08-26T02:00:00.000Z",
    lastUsableAt: "2026-08-26T02:00:00.000Z",
  }), now).state, "stale");
  assert.equal(portfolioRefreshHealth(refreshSummary({
    latestStartedAt: "2026-08-25T01:30:00.000Z",
    latestFinishedAt: "2026-08-25T02:00:00.000Z",
    lastSuccessfulAt: "2026-08-25T02:00:00.000Z",
    lastUsableAt: "2026-08-25T02:00:00.000Z",
  }), now).state, "stale");
  assert.equal(portfolioRefreshHealth(null, now).state, "missing");
});

test("methodology refresh failures do not prevent later methodologies from running", async () => {
  const attempted: string[] = [];
  const results = await runPortfolioRefreshTasksIndependently(["equal", "score_blend"], async (methodology) => {
    attempted.push(methodology);
    if (methodology === "equal") throw new Error("equal failed");
  });
  assert.deepEqual(attempted, ["equal", "score_blend"]);
  assert.equal(results[0].error instanceof Error, true);
  assert.equal(results[1].error, null);
});
