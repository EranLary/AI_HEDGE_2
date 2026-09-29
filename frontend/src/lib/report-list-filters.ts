import type { DashboardPayload } from "@/lib/dashboard-types";

export type ReportGoldFilter = "all" | "golden" | "standard";
export type ReportScoreFilter = "all" | "positive" | "negative";

type ReportFilterRow = {
  is_golden?: boolean;
  score: number | null;
};

export function normalizeReportGoldFilter(value: unknown): ReportGoldFilter {
  return value === "golden" || value === "standard" ? value : "all";
}

export function normalizeReportScoreFilter(value: unknown): ReportScoreFilter {
  return value === "positive" || value === "negative" ? value : "all";
}

export function isGoldenReport(
  dashboard: Pick<DashboardPayload, "valuation_hub"> | null | undefined,
  currentPrice: number | null | undefined,
): boolean {
  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice) || currentPrice <= 0) return false;

  const methods = Array.isArray(dashboard?.valuation_hub?.method_blocks)
    ? dashboard.valuation_hub.method_blocks
    : [];

  return methods.length > 0 && methods.every((method) => (
    typeof method?.target_price === "number" &&
    Number.isFinite(method.target_price) &&
    method.target_price > currentPrice
  ));
}

export function reportMatchesListFilters(
  report: ReportFilterRow,
  gold: ReportGoldFilter,
  score: ReportScoreFilter,
): boolean {
  if (gold === "golden" && !report.is_golden) return false;
  if (gold === "standard" && report.is_golden) return false;
  if (score === "positive" && !(typeof report.score === "number" && report.score > 0)) return false;
  if (score === "negative" && !(typeof report.score === "number" && report.score < 0)) return false;
  return true;
}
