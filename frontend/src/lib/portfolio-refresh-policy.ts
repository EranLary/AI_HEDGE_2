export function planPaperCutoffs(args: {
  explicitCutoff: string | null;
  existingCutoffDates: string[];
  defaultInitialCutoff: string;
  completedUniverseCutoff?: string | null;
  newMonthlyCutoffs: string[];
}): string[] {
  if (args.explicitCutoff) return [args.explicitCutoff];
  if (!args.existingCutoffDates.length) {
    return [args.completedUniverseCutoff || args.defaultInitialCutoff];
  }
  return Array.from(new Set([
    ...args.existingCutoffDates,
    ...args.newMonthlyCutoffs,
  ])).sort();
}

export type PortfolioRefreshRunStatus = "running" | "completed" | "partial" | "failed";

export type PortfolioRefreshRunSummary = {
  latestStatus: PortfolioRefreshRunStatus | null;
  latestStartedAt: string | null;
  latestFinishedAt: string | null;
  lastSuccessfulAt: string | null;
  lastUsableAt: string | null;
  providerWarningCount: number;
};

export type PortfolioRefreshHealthState = "fresh" | "running" | "partial" | "failed" | "stale" | "missing";

export type PortfolioRefreshHealth = PortfolioRefreshRunSummary & {
  state: PortfolioRefreshHealthState;
  expectedAfter: string;
};

// Mirrors `.github/workflows/portfolio-performance.yml`: 01:30 UTC, Tuesday-Saturday.
const REFRESH_HOUR_UTC = 1;
const REFRESH_MINUTE_UTC = 30;
const REFRESH_GRACE_HOURS = 6;
const RUNNING_TIMEOUT_HOURS = 3;
const HOUR_MS = 60 * 60 * 1000;

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function latestExpectedPortfolioRefreshAt(now: Date = new Date()): string {
  const eligibleBefore = now.getTime() - (REFRESH_GRACE_HOURS * HOUR_MS);
  const cursor = new Date(eligibleBefore);
  cursor.setUTCHours(REFRESH_HOUR_UTC, REFRESH_MINUTE_UTC, 0, 0);
  if (cursor.getTime() > eligibleBefore) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (cursor.getUTCDay() < 2 || cursor.getUTCDay() > 6) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return cursor.toISOString();
}

export function portfolioRefreshHealth(
  summary: PortfolioRefreshRunSummary | null,
  now: Date = new Date(),
): PortfolioRefreshHealth {
  const expectedAfter = latestExpectedPortfolioRefreshAt(now);
  const empty: PortfolioRefreshRunSummary = {
    latestStatus: null,
    latestStartedAt: null,
    latestFinishedAt: null,
    lastSuccessfulAt: null,
    lastUsableAt: null,
    providerWarningCount: 0,
  };
  if (!summary) return { ...empty, state: "missing", expectedAfter };

  const latestStartedMs = timestampMs(summary.latestStartedAt);
  const latestFinishedMs = timestampMs(summary.latestFinishedAt);
  const lastSuccessfulMs = timestampMs(summary.lastSuccessfulAt);
  const lastUsableMs = timestampMs(summary.lastUsableAt);
  const expectedMs = timestampMs(expectedAfter);
  const latestAttemptIsNewer = latestStartedMs > lastUsableMs;

  if (summary.latestStatus === "running" && latestAttemptIsNewer) {
    const state = now.getTime() - latestStartedMs <= RUNNING_TIMEOUT_HOURS * HOUR_MS
      ? "running"
      : "stale";
    return { ...summary, state, expectedAfter };
  }
  if (summary.latestStatus === "failed" && latestAttemptIsNewer) {
    return { ...summary, state: "failed", expectedAfter };
  }
  if (
    summary.latestStatus === "partial"
    && latestFinishedMs >= lastSuccessfulMs
    && latestFinishedMs >= expectedMs
  ) {
    return { ...summary, state: "partial", expectedAfter };
  }
  if (!lastUsableMs) return { ...summary, state: "missing", expectedAfter };
  if (lastUsableMs < expectedMs) return { ...summary, state: "stale", expectedAfter };
  return { ...summary, state: "fresh", expectedAfter };
}

export type PortfolioRefreshTaskResult<T> = {
  item: T;
  error: unknown | null;
};

export async function runPortfolioRefreshTasksIndependently<T>(
  items: readonly T[],
  refresh: (item: T) => Promise<void>,
): Promise<Array<PortfolioRefreshTaskResult<T>>> {
  const results: Array<PortfolioRefreshTaskResult<T>> = [];
  for (const item of items) {
    try {
      await refresh(item);
      results.push({ item, error: null });
    } catch (error) {
      results.push({ item, error });
    }
  }
  return results;
}
