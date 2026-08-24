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
