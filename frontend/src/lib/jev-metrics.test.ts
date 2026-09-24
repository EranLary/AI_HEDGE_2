import assert from "node:assert/strict";
import test from "node:test";

import { computeJevMetrics, type JevMetricPrediction } from "./jev-metrics";

test("Jev metrics keep hit rate, Brier score, and calibration mathematically distinct", () => {
  const rows: JevMetricPrediction[] = [
    {
      report_id: "r1",
      horizon: "1w",
      probability_up: 0.1,
      outcome_status: "realized",
      outcome_at: "2026-01-08",
      realized_up: false,
      was_correct: true,
      brier_score: 0.01,
    },
    {
      report_id: "r1",
      horizon: "1m",
      probability_up: 0.3,
      outcome_status: "realized",
      outcome_at: "2026-02-01",
      realized_up: true,
      was_correct: false,
      brier_score: 0.49,
    },
    {
      report_id: "r2",
      horizon: "1w",
      probability_up: 0.7,
      outcome_status: "realized",
      outcome_at: "2026-01-08",
      realized_up: true,
      was_correct: true,
      brier_score: 0.09,
    },
    {
      report_id: "r2",
      horizon: "5y",
      probability_up: 0.9,
      outcome_status: "pending",
      realized_up: null,
      was_correct: null,
      brier_score: null,
    },
  ];

  const result = computeJevMetrics(rows, "forward");

  assert.equal(result.reports, 2);
  assert.equal(result.scope, "all");
  assert.equal(result.overall.predictions, 4);
  assert.equal(result.overall.resolved, 3);
  assert.equal(result.overall.pending, 1);
  assert.equal(result.overall.hits, 2);
  assert.equal(result.overall.misses, 1);
  assert.ok(Math.abs(Number(result.overall.hit_rate_pct) - 66.6666667) < 1e-6);
  assert.ok(Math.abs(Number(result.overall.mean_brier_score) - 0.1966666667) < 1e-6);
  assert.ok(Math.abs(Number(result.expected_calibration_error) - 0.3666666667) < 1e-6);

  const oneWeek = result.by_horizon.find((row) => row.horizon === "1w");
  assert.equal(oneWeek?.resolved, 2);
  assert.equal(oneWeek?.hit_rate_pct, 100);
  assert.equal(result.timeline.length, 2);
  assert.equal(result.timeline[0]?.date, "2026-01-08");
  assert.equal(result.timeline[0]?.hit_rate_pct, 100);
  assert.equal(result.timeline[1]?.date, "2026-02-01");
  assert.ok(Math.abs(Number(result.timeline[1]?.hit_rate_pct) - 66.6666667) < 1e-6);
  assert.equal(result.calibration[0]?.observed_up_count, 0);
  assert.equal(result.calibration[1]?.observed_up_count, 1);
});

test("Jev positive-only scope measures only YES calls and uses honest calibration bins", () => {
  const rows: JevMetricPrediction[] = [
    {
      report_id: "r1",
      horizon: "1w",
      probability_up: 0.2,
      outcome_status: "realized",
      outcome_at: "2026-01-08",
      realized_up: false,
      was_correct: true,
      brier_score: 0.04,
    },
    {
      report_id: "r1",
      horizon: "1m",
      probability_up: 0.55,
      outcome_status: "realized",
      outcome_at: "2026-02-01",
      realized_up: true,
      was_correct: true,
      brier_score: 0.2025,
    },
    {
      report_id: "r2",
      horizon: "1w",
      probability_up: 0.7,
      outcome_status: "realized",
      outcome_at: "2026-01-08",
      realized_up: false,
      was_correct: false,
      brier_score: 0.49,
    },
    {
      report_id: "r3",
      horizon: "5y",
      probability_up: 0.9,
      outcome_status: "pending",
      realized_up: null,
      was_correct: null,
      brier_score: null,
    },
  ];

  const result = computeJevMetrics(rows, "forward", "positive_only");

  assert.equal(result.scope, "positive_only");
  assert.equal(result.reports, 3);
  assert.equal(result.overall.predictions, 3);
  assert.equal(result.overall.resolved, 2);
  assert.equal(result.overall.hits, 1);
  assert.equal(result.overall.misses, 1);
  assert.equal(result.overall.hit_rate_pct, 50);
  assert.deepEqual(result.calibration.map((bucket) => bucket.label), ["50–60%", "60–80%", "80–100%"]);
  assert.equal(result.calibration[0]?.count, 1);
  assert.equal(result.calibration[0]?.observed_up_count, 1);
  assert.equal(result.calibration[1]?.count, 1);
  assert.equal(result.calibration[1]?.observed_up_count, 0);
});
