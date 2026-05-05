export type Direction = -1 | 0 | 1 | null;
export type Verdict = "hit" | "miss" | "-";

export const NOTIONAL_BASE_USD = 100_000;

export type HitRateCounts = {
  hits: number;
  misses: number;
  neutral: number;
  considered: number;
  hit_rate_pct: number | null;
};

export type HitRateAccumulator = {
  hits: number;
  misses: number;
  neutral: number;
};

export function directionOf(value: number | null | undefined): Direction {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

export function actualDirectionFromPrices(
  liveCurrentPrice: number | null | undefined,
  reportCurrentPrice: number | null | undefined,
): Direction {
  if (typeof liveCurrentPrice !== "number" || !Number.isFinite(liveCurrentPrice)) return null;
  if (typeof reportCurrentPrice !== "number" || !Number.isFinite(reportCurrentPrice)) return null;
  return directionOf(liveCurrentPrice - reportCurrentPrice);
}

export function targetDirectionWithFloor(
  targetPrice: number | null | undefined,
  reportCurrentPrice: number | null | undefined,
): Direction {
  if (typeof reportCurrentPrice !== "number" || !Number.isFinite(reportCurrentPrice)) return null;
  if (typeof targetPrice !== "number" || !Number.isFinite(targetPrice)) return null;
  const effectiveTarget = targetPrice < 0 ? 0 : targetPrice;
  return directionOf(effectiveTarget - reportCurrentPrice);
}

export function allocationDirectionFromAmount(investmentAmount: number | null | undefined): Direction {
  if (typeof investmentAmount !== "number" || !Number.isFinite(investmentAmount)) return null;
  const allocationPct = (investmentAmount / NOTIONAL_BASE_USD) * 100;
  return directionOf(allocationPct);
}

export function verdictFromDirections(predicted: Direction, actual: Direction): Verdict {
  if (predicted === null || actual === null) return "-";
  if (predicted === 0 || actual === 0) return "-";
  return predicted === actual ? "hit" : "miss";
}

export function createAccumulator(): HitRateAccumulator {
  return { hits: 0, misses: 0, neutral: 0 };
}

export function applyVerdict(acc: HitRateAccumulator, verdict: Verdict): void {
  if (verdict === "hit") {
    acc.hits += 1;
    return;
  }
  if (verdict === "miss") {
    acc.misses += 1;
    return;
  }
  acc.neutral += 1;
}

export function mergeAccumulators(a: HitRateAccumulator, b: HitRateAccumulator): HitRateAccumulator {
  return {
    hits: a.hits + b.hits,
    misses: a.misses + b.misses,
    neutral: a.neutral + b.neutral,
  };
}

export function finalizeAccumulator(acc: HitRateAccumulator): HitRateCounts {
  const considered = acc.hits + acc.misses;
  return {
    hits: acc.hits,
    misses: acc.misses,
    neutral: acc.neutral,
    considered,
    hit_rate_pct: considered > 0 ? (acc.hits / considered) * 100 : null,
  };
}
