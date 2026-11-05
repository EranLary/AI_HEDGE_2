import type { Direction } from "./hit-rate-utils";
import { directionOf, targetDirectionWithFloor } from "./hit-rate-utils";
import {
  shouldIncludePrediction,
  technicalSignalDirection,
  toNumOrNull,
  valuationModelPredictions,
  type HitRateMode,
} from "./hit-rate-aggregate";
import type { DashboardPayload } from "./dashboard-types";

export type HorizonKey = "1d" | "1w" | "1m" | "3m" | "6m" | "1y" | "3y" | "5y" | "current";

export type HistoricalPricePoint = {
  date: string;
  close: number;
  adjusted_close: number;
};

export type HorizonSourceReport = {
  ticker: string;
  generatedAt: string;
  availableAt?: string;
  payload: DashboardPayload;
};

export type HorizonMetric = {
  horizon: HorizonKey;
  label: string;
  horizon_days: number | null;
  predictions: number;
  resolved: number;
  pending: number;
  unavailable: number;
  hits: number;
  misses: number;
  neutral: number;
  considered: number;
  hit_rate_pct: number | null;
};

export type HorizonModelRow = {
  key: string;
  label: string;
  by_horizon: HorizonMetric[];
};

export type HorizonAccuracy = {
  technical: {
    by_horizon: HorizonMetric[];
  };
  fundamental: {
    by_horizon: HorizonMetric[];
    by_model: HorizonModelRow[];
  };
};

type HorizonDefinition = {
  horizon: HorizonKey;
  label: string;
  days: number | null;
};

type HorizonAccumulator = {
  predictions: number;
  pending: number;
  unavailable: number;
  hits: number;
  misses: number;
  neutral: number;
};

export const TECHNICAL_HORIZONS: HorizonDefinition[] = [
  { horizon: "1d", label: "1 Day", days: 1 },
  { horizon: "1w", label: "1 Week", days: 7 },
  { horizon: "1m", label: "1 Month", days: 30 },
  { horizon: "3m", label: "3 Months", days: 91 },
  { horizon: "current", label: "Current", days: null },
];

export const FUNDAMENTAL_HORIZONS: HorizonDefinition[] = [
  { horizon: "6m", label: "6 Months", days: 182 },
  { horizon: "1y", label: "1 Year", days: 365 },
  { horizon: "3y", label: "3 Years", days: 365 * 3 },
  { horizon: "5y", label: "5 Years", days: 365 * 5 },
  { horizon: "current", label: "Current", days: null },
];

function createAccumulator(): HorizonAccumulator {
  return { predictions: 0, pending: 0, unavailable: 0, hits: 0, misses: 0, neutral: 0 };
}

function accumulatorMap(definitions: HorizonDefinition[]): Map<HorizonKey, HorizonAccumulator> {
  return new Map(definitions.map((definition) => [definition.horizon, createAccumulator()]));
}

function finalize(definition: HorizonDefinition, accumulator: HorizonAccumulator): HorizonMetric {
  const considered = accumulator.hits + accumulator.misses;
  return {
    horizon: definition.horizon,
    label: definition.label,
    horizon_days: definition.days,
    predictions: accumulator.predictions,
    resolved: considered,
    pending: accumulator.pending,
    unavailable: accumulator.unavailable,
    hits: accumulator.hits,
    misses: accumulator.misses,
    neutral: accumulator.neutral,
    considered,
    hit_rate_pct: considered ? (accumulator.hits / considered) * 100 : null,
  };
}

function parseDate(value: string | undefined): number | null {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function pointDate(point: HistoricalPricePoint): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(point.date || ""));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function normalizedSeries(points: HistoricalPricePoint[] | undefined): Array<HistoricalPricePoint & { timestamp: number }> {
  return (Array.isArray(points) ? points : [])
    .map((point) => ({ ...point, timestamp: pointDate(point) }))
    .filter(
      (point): point is HistoricalPricePoint & { timestamp: number } =>
        typeof point.timestamp === "number"
        && Number.isFinite(point.close)
        && point.close > 0
        && Number.isFinite(point.adjusted_close)
        && point.adjusted_close > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function lastPointOnOrBefore(
  points: Array<HistoricalPricePoint & { timestamp: number }>,
  timestamp: number,
): (HistoricalPricePoint & { timestamp: number }) | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].timestamp <= timestamp) return points[index];
  }
  return null;
}

function firstPointOnOrAfter(
  points: Array<HistoricalPricePoint & { timestamp: number }>,
  timestamp: number,
): (HistoricalPricePoint & { timestamp: number }) | null {
  return points.find((point) => point.timestamp >= timestamp) || null;
}

function adjustedBaseline(
  reportPrice: number,
  reportTimestamp: number,
  points: Array<HistoricalPricePoint & { timestamp: number }>,
): number {
  const reference = lastPointOnOrBefore(points, reportTimestamp);
  if (!reference || reference.close <= 0) return reportPrice;
  const adjustmentFactor = reference.adjusted_close / reference.close;
  return Number.isFinite(adjustmentFactor) && adjustmentFactor > 0
    ? reportPrice * adjustmentFactor
    : reportPrice;
}

type Outcome =
  | { kind: "resolved"; direction: Direction }
  | { kind: "pending" }
  | { kind: "unavailable" };

function outcomeForHorizon(
  definition: HorizonDefinition,
  reportTimestamp: number,
  reportPrice: number,
  adjustedBaselinePrice: number,
  points: Array<HistoricalPricePoint & { timestamp: number }>,
  livePrice: number | null,
  nowTimestamp: number,
): Outcome {
  if (definition.days === null) {
    if (typeof livePrice !== "number" || !Number.isFinite(livePrice) || livePrice <= 0) {
      return { kind: "unavailable" };
    }
    // Current prices and saved report prices are both raw provider quotes. Keep
    // them on the same basis so Current matches the legacy live hit-rate view.
    return { kind: "resolved", direction: directionOf(livePrice - reportPrice) };
  }

  const targetTimestamp = reportTimestamp + definition.days * 24 * 60 * 60 * 1000;
  // Do not resolve against a same-day partial session. A target date becomes
  // eligible only on the following UTC date, when its close is safely frozen.
  if (targetTimestamp >= nowTimestamp) return { kind: "pending" };
  const outcomePoint = firstPointOnOrAfter(points, targetTimestamp);
  if (!outcomePoint) {
    const gracePeriodMs = 14 * 24 * 60 * 60 * 1000;
    return nowTimestamp - targetTimestamp < gracePeriodMs
      ? { kind: "pending" }
      : { kind: "unavailable" };
  }
  return { kind: "resolved", direction: directionOf(outcomePoint.adjusted_close - adjustedBaselinePrice) };
}

function applyPrediction(
  accumulator: HorizonAccumulator,
  predictedDirection: Direction,
  outcome: Outcome,
): void {
  accumulator.predictions += 1;
  if (predictedDirection === 0) {
    accumulator.neutral += 1;
    return;
  }
  if (predictedDirection === null) {
    accumulator.unavailable += 1;
    return;
  }
  if (outcome.kind === "pending") {
    accumulator.pending += 1;
    return;
  }
  if (outcome.kind === "unavailable") {
    accumulator.unavailable += 1;
    return;
  }
  if (outcome.direction === null || outcome.direction === 0) {
    accumulator.neutral += 1;
    return;
  }
  if (predictedDirection === outcome.direction) accumulator.hits += 1;
  else accumulator.misses += 1;
}

function finalizeMap(
  definitions: HorizonDefinition[],
  accumulators: Map<HorizonKey, HorizonAccumulator>,
): HorizonMetric[] {
  return definitions.map((definition) => finalize(definition, accumulators.get(definition.horizon) || createAccumulator()));
}

export function computeHorizonAccuracy(
  reports: HorizonSourceReport[],
  historicalPricesByTicker: Map<string, HistoricalPricePoint[]>,
  livePriceByTicker: Map<string, number | null>,
  mode: HitRateMode = "all",
  now: Date = new Date(),
): HorizonAccuracy {
  const technical = accumulatorMap(TECHNICAL_HORIZONS);
  const fundamental = accumulatorMap(FUNDAMENTAL_HORIZONS);
  const fundamentalByModel = new Map<string, Map<HorizonKey, HorizonAccumulator>>();
  const normalizedByTicker = new Map<string, Array<HistoricalPricePoint & { timestamp: number }>>();
  const nowTimestamp = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  for (const report of reports) {
    const ticker = String(report.ticker || "").trim().toUpperCase();
    const reportTimestamp = parseDate(report.availableAt || report.generatedAt);
    const reportPrice = toNumOrNull(report.payload.valuation_hub?.consensus?.current_price);
    if (!ticker || reportTimestamp === null || reportPrice === null || reportPrice <= 0) continue;

    if (!normalizedByTicker.has(ticker)) {
      normalizedByTicker.set(ticker, normalizedSeries(historicalPricesByTicker.get(ticker)));
    }
    const prices = normalizedByTicker.get(ticker) || [];
    const adjustedBaselinePrice = adjustedBaseline(reportPrice, reportTimestamp, prices);
    const livePrice = livePriceByTicker.get(ticker) ?? null;

    const technicalDirection = technicalSignalDirection(report.payload);
    if (technicalDirection !== null && shouldIncludePrediction(mode, technicalDirection)) {
      for (const definition of TECHNICAL_HORIZONS) {
        const outcome = outcomeForHorizon(
          definition,
          reportTimestamp,
          reportPrice,
          adjustedBaselinePrice,
          prices,
          livePrice,
          nowTimestamp,
        );
        applyPrediction(technical.get(definition.horizon)!, technicalDirection, outcome);
      }
    }

    for (const prediction of valuationModelPredictions(report.payload)) {
      const predictedDirection = targetDirectionWithFloor(prediction.targetPrice, reportPrice);
      if (predictedDirection === null || !shouldIncludePrediction(mode, predictedDirection)) continue;
      if (!fundamentalByModel.has(prediction.name)) {
        fundamentalByModel.set(prediction.name, accumulatorMap(FUNDAMENTAL_HORIZONS));
      }
      const modelAccumulators = fundamentalByModel.get(prediction.name)!;
      for (const definition of FUNDAMENTAL_HORIZONS) {
        const outcome = outcomeForHorizon(
          definition,
          reportTimestamp,
          reportPrice,
          adjustedBaselinePrice,
          prices,
          livePrice,
          nowTimestamp,
        );
        applyPrediction(fundamental.get(definition.horizon)!, predictedDirection, outcome);
        applyPrediction(modelAccumulators.get(definition.horizon)!, predictedDirection, outcome);
      }
    }
  }

  return {
    technical: { by_horizon: finalizeMap(TECHNICAL_HORIZONS, technical) },
    fundamental: {
      by_horizon: finalizeMap(FUNDAMENTAL_HORIZONS, fundamental),
      by_model: Array.from(fundamentalByModel.entries())
        .map(([key, accumulators]) => ({
          key,
          label: key,
          by_horizon: finalizeMap(FUNDAMENTAL_HORIZONS, accumulators),
        }))
        .sort((a, b) => {
          if (a.key === "Consensus") return -1;
          if (b.key === "Consensus") return 1;
          return a.label.localeCompare(b.label);
        }),
    },
  };
}
