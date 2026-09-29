import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPayload } from "./dashboard-types";
import {
  isGoldenReport,
  normalizeReportGoldFilter,
  normalizeReportScoreFilter,
  reportMatchesListFilters,
} from "./report-list-filters";

function dashboardWithTargets(...targets: Array<number | null>): Pick<DashboardPayload, "valuation_hub"> {
  return {
    valuation_hub: {
      method_blocks: targets.map((target, index) => ({
        name: index === 1 ? "Dream Team" : `Model ${index + 1}`,
        target_price: target,
        upside_pct: null,
        investment_amount: null,
        investment_pct: null,
        key_metric_means: {},
        sample_rationale: "",
      })),
      consensus: {},
    },
  };
}

test("golden reports require every model aggregate, including Dream Team, above the report price", () => {
  assert.equal(isGoldenReport(dashboardWithTargets(120, 130, 101), 100), true);
  assert.equal(isGoldenReport(dashboardWithTargets(120, 99, 140), 100), false);
  assert.equal(isGoldenReport(dashboardWithTargets(120, null, 140), 100), false);
});

test("golden reports require a valid report-date price and at least one model", () => {
  assert.equal(isGoldenReport(dashboardWithTargets(120), null), false);
  assert.equal(isGoldenReport(dashboardWithTargets(120), 0), false);
  assert.equal(isGoldenReport(dashboardWithTargets(), 100), false);
});

test("report list filters normalize unknown values and apply golden and score directions", () => {
  assert.equal(normalizeReportGoldFilter("golden"), "golden");
  assert.equal(normalizeReportGoldFilter("unknown"), "all");
  assert.equal(normalizeReportScoreFilter("negative"), "negative");
  assert.equal(normalizeReportScoreFilter("zero"), "all");

  assert.equal(reportMatchesListFilters({ is_golden: true, score: 1 }, "golden", "positive"), true);
  assert.equal(reportMatchesListFilters({ is_golden: false, score: 1 }, "golden", "positive"), false);
  assert.equal(reportMatchesListFilters({ is_golden: true, score: -1 }, "golden", "positive"), false);
  assert.equal(reportMatchesListFilters({ is_golden: false, score: 0 }, "standard", "all"), true);
});
