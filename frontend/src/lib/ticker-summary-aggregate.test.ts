import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPayload } from "./dashboard-types";
import {
  computeTickerSummaryAggregation,
  filterReportsByWindow,
  type SummarySourceReport,
} from "./ticker-summary-aggregate";

function basePayload(): DashboardPayload {
  return {
    ticker: "TEST",
    header: {},
    red_flag_shield: [],
    analysis_matrix: {
      executive_summary_markdown: "",
      key_insights: [],
      bull_insights: [],
      red_flag_insights: [],
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    },
    valuation_hub: {
      method_blocks: [],
      method_tabs: [],
      all_values: {
        metric_means: [],
        source_values: [],
      },
      consensus: {
        current_price: 100,
        mean_target_price: null,
      },
    },
    dream_team: [],
    forecast_forensic_matrix: {
      current_revenue: null,
      target_revenue: null,
      current_earnings: null,
      target_earnings: null,
      forensic_flags: [],
    },
    decision_card: {
      action: "",
      position_size_pct_of_notional: 0,
      mean_investment_amount: null,
      rationale: "",
    },
    artifacts: {},
  };
}

test("computes overview/model/valuator/assumptions means across reports", () => {
  const p1 = basePayload();
  p1.valuation_hub.consensus.mean_target_price = 120;
  p1.decision_card.position_size_pct_of_notional = 10;
  p1.valuation_hub.method_tabs = [
    {
      name: "DCF",
      target_price: 130,
      investment_amount: 10000,
      key_metric_means: {},
      outputs: [
        {
          output_id: 1,
          persona: "Warren Buffett",
          target_price: 125,
          investment_amount: 9000,
          key_numeric_values: [],
          reason_sections: [],
        },
      ],
    },
  ];
  p1.valuation_hub.all_values = {
    metric_means: [
      {
        metric_key: "base_0",
        label: "Base 0",
        mean: 60,
        min: 0,
        max: 0.2,
        sample_count: 1,
        method_count: 1,
        methods: [],
        source_paths: [],
      },
      {
        metric_key: "wacc_0",
        label: "WACC 0",
        mean: 9,
        min: 0,
        max: 0.2,
        sample_count: 1,
        method_count: 1,
        methods: [],
        source_paths: [],
      },
      {
        metric_key: "wacc_1",
        label: "WACC 1",
        mean: 11,
        min: 0,
        max: 0.2,
        sample_count: 1,
        method_count: 1,
        methods: [],
        source_paths: [],
      },
    ],
    source_values: [],
  };

  const p2 = basePayload();
  p2.valuation_hub.consensus.mean_target_price = 140;
  p2.decision_card.position_size_pct_of_notional = 20;
  p2.valuation_hub.method_tabs = [
    {
      name: "DCF",
      target_price: 150,
      investment_amount: 5000,
      key_metric_means: {},
      outputs: [
        {
          output_id: 1,
          persona: "Warren Buffett",
          target_price: 145,
          investment_amount: 7000,
          key_numeric_values: [],
          reason_sections: [],
        },
      ],
    },
  ];
  p2.valuation_hub.all_values = {
    metric_means: [
      {
        metric_key: "base_0",
        label: "Base 0",
        mean: 40,
        min: 0,
        max: 0.4,
        sample_count: 1,
        method_count: 1,
        methods: [],
        source_paths: [],
      },
      {
        metric_key: "wacc_0",
        label: "WACC 0",
        mean: 13,
        min: 0,
        max: 0.2,
        sample_count: 1,
        method_count: 1,
        methods: [],
        source_paths: [],
      },
      {
        metric_key: "wacc_1",
        label: "WACC 1",
        mean: 15,
        min: 0,
        max: 0.2,
        sample_count: 1,
        method_count: 1,
        methods: [],
        source_paths: [],
      },
    ],
    source_values: [],
  };

  const reports: SummarySourceReport[] = [
    { ticker: "TEST", generatedAt: "2026-05-01T00:00:00.000Z", payload: p1 },
    { ticker: "TEST", generatedAt: "2026-05-02T00:00:00.000Z", payload: p2 },
  ];

  const agg = computeTickerSummaryAggregation(reports, "all");
  assert.equal(agg.coverage.reports_total, 2);
  assert.equal(agg.coverage.reports_in_window, 2);
  assert.equal(agg.overview.mean_target_price, 130);
  assert.equal(agg.overview.mean_allocation_pct, 15);

  const dcf = agg.by_model.find((row) => row.key === "Scenario DCF");
  assert.ok(dcf);
  assert.equal(dcf.mean_target_price, 140);
  assert.equal(dcf.mean_allocation_pct, 7.5);

  const valuator = agg.by_valuator.find((row) => row.key === "Warren Buffett");
  assert.ok(valuator);
  assert.equal(valuator.mean_target_price, 135);
  assert.equal(valuator.mean_allocation_pct, 8);

  const assumption = agg.assumptions.find((row) => row.key === "wacc");
  assert.ok(assumption);
  assert.equal(assumption.mean_value, 12);
  assert.equal(assumption.samples, 2);
});

test("filters reports by selected window", () => {
  const p = basePayload();
  const now = Date.parse("2026-05-02T12:00:00.000Z");
  const reports: SummarySourceReport[] = [
    { ticker: "TEST", generatedAt: "2026-05-01T12:00:00.000Z", payload: p },
    { ticker: "TEST", generatedAt: "2026-03-01T12:00:00.000Z", payload: p },
  ];

  assert.equal(filterReportsByWindow(reports, "1w", now).length, 1);
  assert.equal(filterReportsByWindow(reports, "1m", now).length, 1);
  assert.equal(filterReportsByWindow(reports, "3m", now).length, 2);
  assert.equal(filterReportsByWindow(reports, "1y", now).length, 2);
  assert.equal(filterReportsByWindow(reports, "all", now).length, 2);
});
