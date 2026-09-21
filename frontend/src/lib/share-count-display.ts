import type { ShareCountResolution } from "@/lib/dashboard-types";

export function finiteShareCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function resolvedShareCount(
  finalValue: unknown,
  resolution?: ShareCountResolution | null,
): number | null {
  return finiteShareCount(resolution?.selected_shares_outstanding) ?? finiteShareCount(finalValue);
}

export function shareCountChanged(resolution?: ShareCountResolution | null): boolean {
  if (typeof resolution?.changed_from_yahoo === "boolean") return resolution.changed_from_yahoo;
  const finalValue = finiteShareCount(resolution?.selected_shares_outstanding);
  const originalValue = finiteShareCount(resolution?.original_yahoo_shares);
  if (finalValue === null || originalValue === null) return false;
  return Math.abs(finalValue - originalValue) > 0.5;
}

export function formatCompactShares(value: unknown): string {
  const count = finiteShareCount(value);
  if (count === null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(count);
}

export function formatFullShares(value: unknown): string {
  const count = finiteShareCount(value);
  if (count === null) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(count);
}

export function shareCountDelta(resolution?: ShareCountResolution | null): {
  count: number;
  percent: number;
} | null {
  const finalValue = finiteShareCount(resolution?.selected_shares_outstanding);
  const originalValue = finiteShareCount(resolution?.original_yahoo_shares);
  if (finalValue === null || originalValue === null) return null;
  return {
    count: finalValue - originalValue,
    percent: ((finalValue - originalValue) / originalValue) * 100,
  };
}
