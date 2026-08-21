export const NASDAQ_EXECUTION_WINDOW_LABEL = "10:00-01:00 UTC (13:00-04:00 Israel summer; 12:00-03:00 winter)";

export function isPreferredNasdaqExecutionWindow(date = new Date()): boolean {
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  return minute >= 10 * 60 || minute < 60;
}

export function enforceNasdaqExecutionWindow(): boolean {
  const raw = String(process.env.NASDAQ_ENFORCE_EXECUTION_WINDOW ?? "1").trim().toLowerCase();
  return !new Set(["0", "false", "no", "off"]).has(raw);
}

function positiveNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function configuredNasdaqConcurrency(): number {
  const fallback = String(process.env.NASDAQ_WORKER_URL || "").trim() ? 4 : 1;
  return Math.max(1, Math.min(12, Math.trunc(positiveNumber("NASDAQ_RUN_CONCURRENCY", fallback))));
}

export function configuredNasdaqCostPerAttempt(): number {
  return Number(positiveNumber("NASDAQ_ESTIMATED_COST_PER_ATTEMPT_USD", 2).toFixed(4));
}

export function configuredNasdaqBudget(): number {
  return Number(positiveNumber("NASDAQ_RUN_BUDGET_USD", 300).toFixed(2));
}
