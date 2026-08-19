export type TradingAgentsDecisionTone = "up" | "down" | "neutral";

const UP_RATINGS = new Set(["buy", "strong buy", "overweight", "overwhight", "outperform", "accumulate"]);
const DOWN_RATINGS = new Set(["sell", "strong sell", "underweight", "underwhight", "underperform", "reduce"]);

function normalizeRating(value: unknown): string {
  return String(value || "")
    .replace(/\*+/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

function explicitRatingFromText(value: unknown): string {
  const text = String(value || "");
  const ratingLine = text.match(
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[-*]\s*)?\*{0,2}rating\*{0,2}\s*:\s*\*{0,2}(strong\s+buy|strong\s+sell|overweight|overwhight|underweight|underwhight|outperform|underperform|accumulate|reduce|buy|hold|sell)\b/i,
  );
  if (ratingLine?.[1]) return normalizeRating(ratingLine[1]);

  const finalStance = text.match(
    /(?:^|\n)[^\n]*final\s+stance\s*:\s*[^\n]*?\b(strong\s+buy|strong\s+sell|overweight|overwhight|underweight|underwhight|outperform|underperform|accumulate|reduce|buy|hold|sell)\b/i,
  );
  return finalStance?.[1] ? normalizeRating(finalStance[1]) : "";
}

function toneFromRating(rating: string): TradingAgentsDecisionTone | null {
  if (UP_RATINGS.has(rating)) return "up";
  if (DOWN_RATINGS.has(rating)) return "down";
  if (rating === "hold") return "neutral";
  return null;
}

export function tradingAgentsDecisionTone(
  rating?: unknown,
  finalCommitteeView?: unknown,
): TradingAgentsDecisionTone {
  for (const candidate of [rating, finalCommitteeView]) {
    const exactTone = toneFromRating(normalizeRating(candidate));
    if (exactTone) return exactTone;

    const explicitTone = toneFromRating(explicitRatingFromText(candidate));
    if (explicitTone) return explicitTone;
  }
  return "neutral";
}

export function tradingAgentsDisplayDecision(rating?: unknown, finalCommitteeView?: unknown): string {
  const structuredRating = String(rating || "").trim();
  return structuredRating || String(finalCommitteeView || "").trim();
}
