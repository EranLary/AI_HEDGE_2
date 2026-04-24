export const RUN_PROGRESS_STEPS = [
  "Collecting data",
  "Financial extraction",
  "Parsing filings",
  "Reading transcripts",
  "Market context",
  "Bull analysis",
  "Bear analysis",
  "Running valuations",
  "Model voting",
  "Finalizing results",
] as const;

export function getProgressStep(percent: number): string {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const idx = Math.min(RUN_PROGRESS_STEPS.length - 1, Math.floor(clamped / 10));
  return RUN_PROGRESS_STEPS[idx];
}

export function getProgressStepNumber(percent: number): number {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return Math.min(RUN_PROGRESS_STEPS.length, Math.floor(clamped / 10) + 1);
}
