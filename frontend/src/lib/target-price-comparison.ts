export type TargetPriceTone = "positive" | "negative" | "neutral";

export function targetPriceTone(target: number | null, current: number | null): TargetPriceTone {
  if (
    typeof target !== "number" ||
    !Number.isFinite(target) ||
    typeof current !== "number" ||
    !Number.isFinite(current)
  ) {
    return "neutral";
  }
  if (target > current) return "positive";
  if (target < current) return "negative";
  return "neutral";
}
