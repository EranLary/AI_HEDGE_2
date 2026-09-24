export type JevForecastMode = "forward" | "retrospective";
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

function calibrationBuckets(rows: JevMetricPrediction[]): JevCalibrationBucket[] {
  const realized = rows.filter(
    (row) => row.outcome_status === "realized" && typeof row.realized_up === "boolean",
  );
  return Array.from({ length: 5 }, (_unused, index) => {
    const lower = index * 0.2;
    const upper = index === 4 ? 1.0000001 : (index + 1) * 0.2;
    const bucketRows = realized.filter(
      (row) => row.probability_up >= lower && row.probability_up < upper,
    );
    const meanProbability = bucketRows.length
      ? bucketRows.reduce((sum, row) => sum + row.probability_up, 0) / bucketRows.length
      : null;
    const observedRate = bucketRows.length
      ? bucketRows.filter((row) => row.realized_up === true).length / bucketRows.length
      : null;
    return {
      key: `${index * 20}-${(index + 1) * 20}`,
      label: `${index * 20}–${(index + 1) * 20}%`,
      count: bucketRows.length,
      mean_probability_up: meanProbability,
      observed_up_rate: observedRate,
      absolute_gap:
        meanProbability !== null && observedRate !== null ? Math.abs(meanProbability - observedRate) : null,
    };
  });
}

function expectedCalibrationError(rows: JevMetricPrediction[]): number | null {
  const populatedBuckets = calibrationBuckets(rows).filter(
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

function timelinePoints(rows: JevMetricPrediction[]): JevTimelinePoint[] {
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
      expected_calibration_error: expectedCalibrationError(cumulative),
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
): JevMetrics {
  const calibration = calibrationBuckets(rows);
  return {
    mode,
    reports: new Set(rows.map((row) => row.report_id)).size,
    overall: metric(rows),
    expected_calibration_error: expectedCalibrationError(rows),
    by_horizon: JEV_HORIZON_ORDER.map((horizon) => ({
      horizon,
      ...metric(rows.filter((row) => row.horizon === horizon)),
    })),
    calibration,
    timeline: timelinePoints(rows),
  };
}
