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
      realized_up: false,
      was_correct: true,
      brier_score: 0.01,
    },
    {
      report_id: "r1",
      horizon: "1m",
      probability_up: 0.3,
      outcome_status: "realized",
      realized_up: true,
      was_correct: false,
      brier_score: 0.49,
    },
    {
      report_id: "r2",
      horizon: "1w",
      probability_up: 0.7,
      outcome_status: "realized",
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
});
