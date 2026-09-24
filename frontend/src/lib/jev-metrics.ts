export type JevForecastMode = "forward" | "retrospective";
export type JevPredictionScope = "all" | "positive_only";
export type JevHorizon = "1w" | "1m" | "3m" | "6m" | "1y" | "3y" | "5y";
export type JevOutcomeStatus = "pending" | "realized" | "unavailable";

export type JevMetricPrediction = {
  report_id: string;
  horizon: JevHorizon;
  probability_up: number;
  outcome_status: JevOutcomeStatus;
  outcome_at?: string | null;
  realized_up: boolean | null;
  was_correct: boolean | null;
  brier_score: number | null;
};

export type JevMetric = {
  predictions: number;
  resolved: number;
  pending: number;
  hits: number;
  misses: number;
  hit_rate_pct: number | null;
  mean_brier_score: number | null;
};

export type JevCalibrationBucket = {
  key: string;
  label: string;
  count: number;
  observed_up_count: number;
  mean_probability_up: number | null;
  observed_up_rate: number | null;
  absolute_gap: number | null;
};

export type JevTimelinePoint = {
  date: string;
  resolved: number;
  hits: number;
  misses: number;
  hit_rate_pct: number | null;
  mean_brier_score: number | null;
  expected_calibration_error: number | null;
};

export type JevMetrics = {
  mode: JevForecastMode;
  scope: JevPredictionScope;
  reports: number;
  overall: JevMetric;
  expected_calibration_error: number | null;
  by_horizon: Array<JevMetric & { horizon: JevHorizon }>;
  calibration: JevCalibrationBucket[];
  timeline: JevTimelinePoint[];
};

export const JEV_HORIZON_ORDER: JevHorizon[] = ["1w", "1m", "3m", "6m", "1y", "3y", "5y"];

function metric(rows: JevMetricPrediction[]): JevMetric {
  const realized = rows.filter((row) => row.outcome_status === "realized" && row.was_correct !== null);
  const hits = realized.filter((row) => row.was_correct === true).length;
  const misses = realized.filter((row) => row.was_correct === false).length;
  const brier = realized
    .map((row) => row.brier_score)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    predictions: rows.length,
    resolved: realized.length,
    pending: rows.filter((row) => row.outcome_status === "pending").length,
    hits,
    misses,
    hit_rate_pct: realized.length ? (hits / realized.length) * 100 : null,
    mean_brier_score: brier.length ? brier.reduce((sum, value) => sum + value, 0) / brier.length : null,
  };
}

type CalibrationRange = {
  lower: number;
  upper: number;
  label: string;
};

const ALL_CALIBRATION_RANGES: CalibrationRange[] = Array.from({ length: 5 }, (_unused, index) => ({
  lower: index * 0.2,
  upper: index === 4 ? 1.0000001 : (index + 1) * 0.2,
  label: `${index * 20}–${(index + 1) * 20}%`,
}));

const POSITIVE_CALIBRATION_RANGES: CalibrationRange[] = [
  { lower: 0.5, upper: 0.6, label: "50–60%" },
  { lower: 0.6, upper: 0.8, label: "60–80%" },
  { lower: 0.8, upper: 1.0000001, label: "80–100%" },
];

function calibrationBuckets(
  rows: JevMetricPrediction[],
  scope: JevPredictionScope,
): JevCalibrationBucket[] {
  const realized = rows.filter(
    (row) => row.outcome_status === "realized" && typeof row.realized_up === "boolean",
  );
  const ranges = scope === "positive_only" ? POSITIVE_CALIBRATION_RANGES : ALL_CALIBRATION_RANGES;
  return ranges.map(({ lower, upper, label }) => {
    const bucketRows = realized.filter(
      (row) => row.probability_up >= lower && row.probability_up < upper,
    );
    const meanProbability = bucketRows.length
      ? bucketRows.reduce((sum, row) => sum + row.probability_up, 0) / bucketRows.length
      : null;
    const observedUpCount = bucketRows.filter((row) => row.realized_up === true).length;
    const observedRate = bucketRows.length ? observedUpCount / bucketRows.length : null;
    return {
      key: `${Math.round(lower * 100)}-${Math.round(Math.min(upper, 1) * 100)}`,
      label,
      count: bucketRows.length,
      observed_up_count: observedUpCount,
      mean_probability_up: meanProbability,
      observed_up_rate: observedRate,
      absolute_gap:
        meanProbability !== null && observedRate !== null ? Math.abs(meanProbability - observedRate) : null,
    };
  });
}

function expectedCalibrationError(
  rows: JevMetricPrediction[],
  scope: JevPredictionScope,
): number | null {
  const populatedBuckets = calibrationBuckets(rows, scope).filter(
    (bucket) => bucket.count > 0 && bucket.absolute_gap !== null,
  );
  const count = populatedBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return count
    ? populatedBuckets.reduce(
        (sum, bucket) => sum + Number(bucket.absolute_gap) * bucket.count,
        0,
      ) / count
    : null;
}

function timelinePoints(
  rows: JevMetricPrediction[],
  scope: JevPredictionScope,
): JevTimelinePoint[] {
  const realized = rows
    .filter(
      (row) =>
        row.outcome_status === "realized" &&
        row.was_correct !== null &&
        typeof row.outcome_at === "string" &&
        row.outcome_at.length >= 10,
    )
    .sort((a, b) => String(a.outcome_at).localeCompare(String(b.outcome_at)));
  const dates = Array.from(new Set(realized.map((row) => String(row.outcome_at).slice(0, 10))));
  const points = dates.map((date) => {
    const cumulative = realized.filter((row) => String(row.outcome_at).slice(0, 10) <= date);
    const summary = metric(cumulative);
    return {
      date,
      resolved: summary.resolved,
      hits: summary.hits,
      misses: summary.misses,
      hit_rate_pct: summary.hit_rate_pct,
      mean_brier_score: summary.mean_brier_score,
      expected_calibration_error: expectedCalibrationError(cumulative, scope),
    };
  });
  if (points.length <= 24) return points;
  const selected = new Set<number>();
  for (let index = 0; index < 24; index += 1) {
    selected.add(Math.round((index * (points.length - 1)) / 23));
  }
  return points.filter((_point, index) => selected.has(index));
}

export function computeJevMetrics(
  rows: JevMetricPrediction[],
  mode: JevForecastMode,
  scope: JevPredictionScope = "all",
): JevMetrics {
  const scopedRows = scope === "positive_only"
    ? rows.filter((row) => row.probability_up >= 0.5)
    : rows;
  const calibration = calibrationBuckets(scopedRows, scope);
  return {
    mode,
    scope,
    reports: new Set(scopedRows.map((row) => row.report_id)).size,
    overall: metric(scopedRows),
    expected_calibration_error: expectedCalibrationError(scopedRows, scope),
    by_horizon: JEV_HORIZON_ORDER.map((horizon) => ({
      horizon,
      ...metric(scopedRows.filter((row) => row.horizon === horizon)),
    })),
    calibration,
    timeline: timelinePoints(scopedRows, scope),
  };
}
