import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPortfolioProviderWarnings,
  isPortfolioPriceQuarantinedOn,
  latestExpectedPortfolioRefreshAt,
  observePortfolioPriceMissing,
  observePortfolioPriceRecovery,
  planPaperCutoffs,
  portfolioRefreshHealth,
  runPortfolioRefreshTasksIndependently,
  type PortfolioRefreshRunSummary,
} from "./portfolio-refresh-policy";

test("three distinct missing observations quarantine a symbol without double-counting reruns", () => {
  const first = observePortfolioPriceMissing(null, "2026-09-21");
  const repeated = observePortfolioPriceMissing(first, "2026-09-21");
  const second = observePortfolioPriceMissing(repeated, "2026-09-22");
  const third = observePortfolioPriceMissing(second, "2026-09-23");

  assert.equal(first.status, "monitoring");
  assert.equal(repeated.changed, false);
  assert.equal(repeated.missingStreak, 1);
  assert.equal(second.missingStreak, 2);
  assert.equal(third.status, "quarantined");
  assert.equal(third.event, "quarantined");
});

test("a quarantined symbol requires three distinct recoveries and never downgrades on a renewed miss", () => {
  const quarantined = observePortfolioPriceMissing({
    status: "monitoring",
    lastObservedOn: "2026-09-22",
    lastObservationMissing: true,
    missingStreak: 2,
    recoveryStreak: 0,
  }, "2026-09-23");
  const firstRecovery = observePortfolioPriceRecovery(quarantined, "2026-09-24");
  const missingAgain = observePortfolioPriceMissing(firstRecovery, "2026-09-25");
  const recoveryOne = observePortfolioPriceRecovery(missingAgain, "2026-09-26");
  const recoveryTwo = observePortfolioPriceRecovery(recoveryOne, "2026-09-29");
  const recoveryThree = observePortfolioPriceRecovery(recoveryTwo, "2026-09-30");

  assert.equal(firstRecovery.status, "quarantined");
  assert.equal(missingAgain.status, "quarantined");
  assert.equal(missingAgain.missingStreak, 1);
  assert.equal(recoveryTwo.status, "quarantined");
  assert.equal(recoveryThree.status, "resolved");
  assert.equal(recoveryThree.event, "resolved");
});

test("a monitored one-off gap resolves after the next successful observation", () => {
  const missing = observePortfolioPriceMissing(null, "2026-09-21");
  const recovered = observePortfolioPriceRecovery(missing, "2026-09-22");

  assert.equal(recovered.status, "resolved");
  assert.equal(recovered.recoveryStreak, 1);
});

test("a missing observation wins over a conflicting recovery on the same date", () => {
  const monitoring = observePortfolioPriceMissing(null, "2026-09-21");
  const recovered = observePortfolioPriceRecovery(monitoring, "2026-09-22");
  const missingAgain = observePortfolioPriceMissing(recovered, "2026-09-22");

  assert.equal(missingAgain.status, "monitoring");
  assert.equal(missingAgain.lastObservationMissing, true);
  assert.equal(missingAgain.missingStreak, 1);
  assert.equal(missingAgain.changed, true);
});

test("quarantine blocks only cutoffs on or after its effective date", () => {
  assert.equal(isPortfolioPriceQuarantinedOn("quarantined", "2026-09-23", "2026-09-22"), false);
  assert.equal(isPortfolioPriceQuarantinedOn("quarantined", "2026-09-23", "2026-09-23"), true);
  assert.equal(isPortfolioPriceQuarantinedOn("resolved", "2026-09-23", "2026-09-24"), false);
});

test("provider warnings distinguish blocking stale data from visible fallbacks", () => {
  assert.deepEqual(classifyPortfolioProviderWarnings([
    { symbol: "MLTM.TA", error: "no_data" },
    { symbol: "AAPL", error: "timeout" },
    { symbol: "^SP500TR", error: "no_data" },
  ], ["aapl", "^SP500TR"], ["mltm.ta", "aapl", "^SP500TR"]), [
    { symbol: "MLTM.TA", error: "no_data", blocking: false, visible: true },
    { symbol: "AAPL", error: "timeout", blocking: true, visible: true },
    { symbol: "^SP500TR", error: "no_data", blocking: true, visible: true },
  ]);
});

test("provider warnings stay hidden when the ticker is neither required nor selected", () => {
  assert.deepEqual(classifyPortfolioProviderWarnings([
    { symbol: "MLTM.TA", error: "no_data" },
  ], ["AAPL"], ["MSFT"]), [
    { symbol: "MLTM.TA", error: "no_data", blocking: false, visible: false },
  ]);
});

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
