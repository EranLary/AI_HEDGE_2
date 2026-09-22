export function planPaperCutoffs(args: {
  explicitCutoff: string | null;
  existingCutoffDates: string[];
  defaultInitialCutoff: string;
  completedUniverseCutoff?: string | null;
  methodologyLaunchCutoff?: string | null;
  newMonthlyCutoffs: string[];
}): string[] {
  if (args.explicitCutoff) {
    if (args.methodologyLaunchCutoff && args.explicitCutoff < args.methodologyLaunchCutoff) {
      throw new Error(`Paper cutoff ${args.explicitCutoff} predates methodology launch cutoff ${args.methodologyLaunchCutoff}.`);
    }
    return [args.explicitCutoff];
  }
  if (!args.existingCutoffDates.length) {
    const launchFloor = args.methodologyLaunchCutoff || args.defaultInitialCutoff;
    return [[launchFloor, args.completedUniverseCutoff]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) as string];
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

export type PortfolioProviderWarning = {
  symbol: string;
  error: string;
};

export type ClassifiedPortfolioProviderWarning = PortfolioProviderWarning & {
  blocking: boolean;
  visible: boolean;
};

export type PortfolioPriceIncidentStatus = "monitoring" | "quarantined" | "resolved" | "ignored";

export type PortfolioPriceIncidentState = {
  status: PortfolioPriceIncidentStatus;
  lastObservedOn: string | null;
  lastObservationMissing: boolean;
  missingStreak: number;
  recoveryStreak: number;
};

export type PortfolioPriceIncidentTransition = PortfolioPriceIncidentState & {
  changed: boolean;
  event: "price_missing" | "quarantined" | "price_recovered" | "resolved" | null;
  newCycle: boolean;
};

export function observePortfolioPriceMissing(
  current: PortfolioPriceIncidentState | null,
  observedOn: string,
): PortfolioPriceIncidentTransition {
  if (current?.status === "ignored") {
    return { ...current, changed: false, event: null, newCycle: false };
  }
  if (current?.lastObservedOn === observedOn && current.lastObservationMissing) {
    return { ...current, changed: false, event: null, newCycle: false };
  }
  const newCycle = current === null || current.status === "resolved";
  const missingStreak = !newCycle && current.lastObservationMissing
    ? current.missingStreak + 1
    : 1;
  const status = current?.status === "quarantined" || missingStreak >= 3
    ? "quarantined"
    : "monitoring";
  return {
    status,
    lastObservedOn: observedOn,
    lastObservationMissing: true,
    missingStreak,
    recoveryStreak: 0,
    changed: true,
    event: status === "quarantined" && current?.status !== "quarantined"
      ? "quarantined"
      : "price_missing",
    newCycle,
  };
}

export function observePortfolioPriceRecovery(
  current: PortfolioPriceIncidentState,
  observedOn: string,
): PortfolioPriceIncidentTransition {
  if (current.status === "ignored" || current.status === "resolved" || current.lastObservedOn === observedOn) {
    return { ...current, changed: false, event: null, newCycle: false };
  }
  const recoveryStreak = current.lastObservationMissing ? 1 : current.recoveryStreak + 1;
  const resolved = current.status === "monitoring" || recoveryStreak >= 3;
  return {
    status: resolved ? "resolved" : "quarantined",
    lastObservedOn: observedOn,
    lastObservationMissing: false,
    missingStreak: 0,
    recoveryStreak,
    changed: true,
    event: resolved ? "resolved" : "price_recovered",
    newCycle: false,
  };
}

export function isPortfolioPriceQuarantinedOn(
  status: PortfolioPriceIncidentStatus,
  quarantinedOn: string | null,
  date: string,
): boolean {
  return status === "quarantined" && quarantinedOn !== null && date >= quarantinedOn;
}

export function classifyPortfolioProviderWarnings(
  warnings: readonly PortfolioProviderWarning[],
  blockingSymbols: Iterable<string>,
  visibleSymbols: Iterable<string> = [],
): ClassifiedPortfolioProviderWarning[] {
  const blockingSet = new Set(
    Array.from(blockingSymbols, (symbol) => String(symbol || "").trim().toUpperCase()).filter(Boolean),
  );
  const visibleSet = new Set(
    Array.from(visibleSymbols, (symbol) => String(symbol || "").trim().toUpperCase()).filter(Boolean),
  );
  return warnings.map((warning) => {
    const symbol = String(warning.symbol || "").trim().toUpperCase();
    const blocking = blockingSet.has(symbol);
    return { ...warning, symbol, blocking, visible: blocking || visibleSet.has(symbol) };
  });
}

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
