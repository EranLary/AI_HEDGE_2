import type { DashboardPayload } from "./dashboard-types";

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Return the report's canonical disagreement score.
 *
 * Newer reports persist the complete score in score_card.overall_cv, including
 * the direction-mismatch penalty. The consensus CV values remain a legacy
 * fallback for reports that predate that field.
 */
export function disagreementScoreForReport(payload?: DashboardPayload | null): number | null {
  if (!payload) return null;

  const scoreCard = payload.score_card || payload.decision_card;
  const overallCv = finiteNumber(scoreCard?.overall_cv);
  if (overallCv !== null) return Math.abs(overallCv);

  const priceCv = finiteNumber(payload.valuation_hub?.consensus?.cv);
  const lmil = payload.valuation_hub?.consensus?.lmil;
  const investmentCv = Array.isArray(lmil) && lmil.length > 1 ? finiteNumber(lmil[1]) : null;
  const parts = [priceCv, investmentCv]
    .filter((value): value is number => value !== null)
    .map((value) => Math.abs(value));

  if (!parts.length) return null;
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}
