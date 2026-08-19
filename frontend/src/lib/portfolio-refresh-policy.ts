export function planPaperCutoffs(args: {
  explicitCutoff: string | null;
  existingCutoffDates: string[];
  defaultInitialCutoff: string;
  newMonthlyCutoffs: string[];
}): string[] {
  if (args.explicitCutoff) return [args.explicitCutoff];
  if (!args.existingCutoffDates.length) return [args.defaultInitialCutoff];
  return Array.from(new Set([
    ...args.existingCutoffDates,
    ...args.newMonthlyCutoffs,
  ])).sort();
}
