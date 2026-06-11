import type { DashboardPayload } from "@/lib/dashboard-types";
import { NOTIONAL_BASE_USD } from "@/lib/hit-rate-utils";
import { canonicalModelName } from "@/lib/method-display";

export type SummaryWindow = "all" | "1y" | "3m" | "1m" | "1w";

export type SummarySourceReport = {
  ticker: string;
  generatedAt: string;
  payload: DashboardPayload;
};

export type SummaryMeanRow = {
  key: string;
  label: string;
  mean_target_price: number | null;
  mean_allocation_pct: number | null;
  target_samples: number;
  allocation_samples: number;
};

export type SummaryAssumptionRow = {
  key: string;
  label: string;
  mean_value: number | null;
  current_value?: number | null;
  samples: number;
};

export type TickerSummaryAggregation = {
  coverage: {
    reports_total: number;
    reports_in_window: number;
    window: SummaryWindow;
  };
  overview: {
    mean_target_price: number | null;
    mean_allocation_pct: number | null;
    mean_disagreement_score: number | null;
    target_samples: number;
    allocation_samples: number;
    disagreement_samples: number;
  };
  by_model: SummaryMeanRow[];
  by_valuator: SummaryMeanRow[];
  assumptions: SummaryAssumptionRow[];
};

type MeanAccumulator = {
  sumTarget: number;
  countTarget: number;
  sumAllocation: number;
  countAllocation: number;
  sumDisagreement: number;
  countDisagreement: number;
};

type AssumptionAccumulator = {
  sum: number;
  count: number;
};

type DashboardAssumptionMean = {
  key: string;
  label: string;
  mean: number | null;
};

type MetricMeanLike = {
  metric_key?: unknown;
  label?: unknown;
  mean?: unknown;
  min?: unknown;
  max?: unknown;
  sample_count?: unknown;
  method_count?: unknown;
  methods?: unknown;
  source_paths?: unknown;
};

function toNumOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeTarget(value: unknown): number | null {
  const n = toNumOrNull(value);
  if (n === null) return null;
  return n < 0 ? 0 : n;
}

function normalizeLabel(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[_/]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function allocationPctFromAmount(value: unknown): number | null {
  const amount = toNumOrNull(value);
  if (amount === null) return null;
  return (amount / NOTIONAL_BASE_USD) * 100;
}

function reportMs(report: SummarySourceReport): number {
  const ms = Date.parse(String(report.generatedAt || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function createMeanAccumulator(): MeanAccumulator {
  return {
    sumTarget: 0,
    countTarget: 0,
    sumAllocation: 0,
    countAllocation: 0,
    sumDisagreement: 0,
    countDisagreement: 0,
  };
}

function applyMean(
  acc: MeanAccumulator,
  targetPrice: number | null,
  allocationPct: number | null,
  disagreementScore: number | null = null,
): void {
  if (typeof targetPrice === "number" && Number.isFinite(targetPrice)) {
    acc.sumTarget += targetPrice;
    acc.countTarget += 1;
  }
  if (typeof allocationPct === "number" && Number.isFinite(allocationPct)) {
    acc.sumAllocation += allocationPct;
    acc.countAllocation += 1;
  }
  if (typeof disagreementScore === "number" && Number.isFinite(disagreementScore)) {
    acc.sumDisagreement += disagreementScore;
    acc.countDisagreement += 1;
  }
}

function mean(sum: number, count: number): number | null {
  if (!count) return null;
  return sum / count;
}

function toMeanRow(key: string, label: string, acc: MeanAccumulator): SummaryMeanRow {
  return {
    key,
    label,
    mean_target_price: mean(acc.sumTarget, acc.countTarget),
    mean_allocation_pct: mean(acc.sumAllocation, acc.countAllocation),
    target_samples: acc.countTarget,
    allocation_samples: acc.countAllocation,
  };
}

function toAssumptionRow(key: string, label: string, acc: AssumptionAccumulator): SummaryAssumptionRow {
  return {
    key,
    label,
    mean_value: acc.count > 0 ? acc.sum / acc.count : null,
    samples: acc.count,
  };
}

function compareMeanRows(a: SummaryMeanRow, b: SummaryMeanRow): number {
  const aSamples = a.target_samples + a.allocation_samples;
  const bSamples = b.target_samples + b.allocation_samples;
  if (bSamples !== aSamples) return bSamples - aSamples;
  return a.label.localeCompare(b.label);
}

function disagreementScoreForReport(payload: DashboardPayload): number | null {
  const scoreCard = payload.score_card || payload.decision_card;
  const scoreCv = toNumOrNull(scoreCard?.overall_cv);
  if (typeof scoreCv === "number" && Number.isFinite(scoreCv)) {
    return Math.abs(scoreCv);
  }
  const consensusCv = toNumOrNull(payload.valuation_hub?.consensus?.cv);
  const lmil = payload.valuation_hub?.consensus?.lmil;
  const investmentCv =
    Array.isArray(lmil) && lmil.length > 1 ? toNumOrNull(lmil[1]) : null;
  const parts = [consensusCv, investmentCv]
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .map((v) => Math.abs(v));
  if (!parts.length) return null;
  return avg(parts);
}

function shouldKeepReport(report: SummarySourceReport, window: SummaryWindow, nowMs: number): boolean {
  if (window === "all") return true;
  const generatedAtMs = reportMs(report);
  if (!generatedAtMs) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  const ageMs = nowMs - generatedAtMs;
  if (ageMs < 0) return true;
  if (window === "1w") return ageMs <= 7 * dayMs;
  if (window === "1m") return ageMs <= 30 * dayMs;
  if (window === "3m") return ageMs <= 90 * dayMs;
  return ageMs <= 365 * dayMs;
}

function isPlaceholderValuatorLabel(label: string): boolean {
  return /^output\s+\d+$/i.test(String(label || "").trim());
}

const ASSUMPTIONS_ORDER_LABELS = [
  "Base Probability",
  "Bull Probability",
  "Bear Probability",
  "Growth Rate (G)",
  "Representative FCF",
  "Terminal Value Growth",
  "WACC",
  "Representative Revenue",
  "Representative EV/Sales",
  "Representative Earnings",
  "Representative P/E",
] as const;

function buildDashboardAssumptionMeans(payload: DashboardPayload): DashboardAssumptionMean[] {
  const sourceRows = Array.isArray(payload.valuation_hub?.all_values?.metric_means)
    ? (payload.valuation_hub?.all_values?.metric_means as MetricMeanLike[])
    : [];

  const rows: DashboardAssumptionMean[] = [];
  const hasBlendedProbabilities = sourceRows.some((row) => {
    const metricKey = String(row?.metric_key || "").trim().toLowerCase();
    return (
      metricKey === "bull_probability_blended" ||
      metricKey === "base_probability_blended" ||
      metricKey === "bear_probability_blended"
    );
  });
  const mergeBuckets: Record<
    string,
    {
      label: string;
      items: MetricMeanLike[];
    }
  > = {
    predicted_ev_sales: {
      label: "Representative EV/Sales",
      items: [],
    },
    predicted_fcf_next_year: {
      label: "Representative FCF",
      items: [],
    },
    growth_rate_g: {
      label: "Growth Rate (G)",
      items: [],
    },
    terminal_value_growth: {
      label: "Terminal Value Growth",
      items: [],
    },
    wacc: {
      label: "WACC",
      items: [],
    },
  };

  const removeExact = new Set([
    "investment amount",
    "net financing result",
    "net income 3y 0",
    "net income 3y 1",
    "revenue 3y 0",
    "revenue 3y 1",
    "operating profitability margin",
    "target market cap",
    "revenue growth 3y avg",
  ]);

  for (const rawRow of sourceRows) {
    const baseLabel = String(rawRow?.label || rawRow?.metric_key || "").trim();
    if (!baseLabel) continue;
    const normalized = normalizeLabel(baseLabel);

    if (normalized === "base 1" || normalized === "bear 1" || normalized === "bull 1") {
      continue;
    }
    if (
      hasBlendedProbabilities &&
      (normalized === "base 0" || normalized === "bear 0" || normalized === "bull 0")
    ) {
      // Prefer explicit blended probability rows when present.
      continue;
    }

    if (
      removeExact.has(normalized) ||
      normalized === "p e multiple" ||
      normalized === "pe multiple" ||
      normalized === "pe multiple 0" ||
      normalized === "pe multiple 1"
    ) {
      continue;
    }

    if (normalized === "ev sales multiple 0" || normalized === "ev sales multiple 1") {
      mergeBuckets.predicted_ev_sales.items.push(rawRow);
      continue;
    }
    if (normalized === "fcf next year 0" || normalized === "fcf next year 1") {
      mergeBuckets.predicted_fcf_next_year.items.push(rawRow);
      continue;
    }
    if (normalized === "g 0" || normalized === "g 1") {
      mergeBuckets.growth_rate_g.items.push(rawRow);
      continue;
    }
    if (normalized === "terminal 0" || normalized === "terminal 1") {
      mergeBuckets.terminal_value_growth.items.push(rawRow);
      continue;
    }
    if (normalized === "wacc 0" || normalized === "wacc 1") {
      mergeBuckets.wacc.items.push(rawRow);
      continue;
    }

    const renamedLabel =
      normalized === "base 0"
        ? "Base Probability"
        : normalized === "bear 0"
          ? "Bear Probability"
          : normalized === "bull 0"
            ? "Bull Probability"
            : normalized === "predicted revenue"
              ? "Representative Revenue"
              : normalized === "predicted ev sales"
                ? "Representative EV/Sales"
                : normalized === "predicted earnings"
                  ? "Representative Earnings"
                  : normalized === "predicted p e"
                    ? "Representative P/E"
                    : normalized === "predicted fcf next year"
                      ? "Representative FCF"
            : baseLabel;
    rows.push({
      key: normalizeLabel(renamedLabel),
      label: renamedLabel,
      mean: toNumOrNull(rawRow?.mean),
    });
  }

  for (const bucket of Object.values(mergeBuckets)) {
    if (!bucket.items.length) continue;
    const means = bucket.items.map((item) => toNumOrNull(item?.mean)).filter((v): v is number => v !== null);
    rows.push({
      key: normalizeLabel(bucket.label),
      label: bucket.label,
      mean: means.length ? avg(means) : null,
    });
  }

  const byKey = new Map<string, DashboardAssumptionMean>();
  for (const row of rows) {
    if (!row.key || byKey.has(row.key)) continue;
    byKey.set(row.key, row);
  }

  return ASSUMPTIONS_ORDER_LABELS
    .map((label) => byKey.get(normalizeLabel(label)) || null)
    .filter((row): row is DashboardAssumptionMean => row !== null);
}

export function filterReportsByWindow(
  reports: SummarySourceReport[],
  window: SummaryWindow,
  nowMs: number = Date.now(),
): SummarySourceReport[] {
  return reports.filter((report) => shouldKeepReport(report, window, nowMs));
}

export function computeTickerSummaryAggregation(
  reports: SummarySourceReport[],
  window: SummaryWindow,
): TickerSummaryAggregation {
  const filtered = filterReportsByWindow(reports, window);
  const overviewAcc = createMeanAccumulator();
  const modelMap = new Map<string, MeanAccumulator>();
  const valuatorMap = new Map<string, MeanAccumulator>();
  const assumptionsMap = new Map<string, { label: string; acc: AssumptionAccumulator }>();

  const applyModel = (name: string, targetPrice: number | null, allocationPct: number | null) => {
    if (targetPrice === null && allocationPct === null) return;
    const key = canonicalModelName(String(name || "").trim());
    if (!modelMap.has(key)) {
      modelMap.set(key, createMeanAccumulator());
    }
    const acc = modelMap.get(key)!;
    applyMean(acc, targetPrice, allocationPct);
  };

  const applyValuator = (name: string, targetPrice: number | null, allocationPct: number | null) => {
    if (targetPrice === null && allocationPct === null) return;
    const key = String(name || "").trim();
    if (!key || isPlaceholderValuatorLabel(key)) return;
    if (!valuatorMap.has(key)) {
      valuatorMap.set(key, createMeanAccumulator());
    }
    const acc = valuatorMap.get(key)!;
    applyMean(acc, targetPrice, allocationPct);
  };

  for (const report of filtered) {
    const payload = report.payload;
    const overviewTarget = safeTarget(payload.valuation_hub?.consensus?.mean_target_price);
    const overviewAllocation =
      toNumOrNull((payload.score_card || payload.decision_card)?.position_size_pct_of_notional) ??
      allocationPctFromAmount((payload.score_card || payload.decision_card)?.mean_investment_amount);
    const disagreementScore = disagreementScoreForReport(payload);
    applyMean(overviewAcc, overviewTarget, overviewAllocation, disagreementScore);

    const methodTabs = Array.isArray(payload.valuation_hub?.method_tabs) ? payload.valuation_hub.method_tabs : [];
    const methodBlocks = Array.isArray(payload.valuation_hub?.method_blocks) ? payload.valuation_hub.method_blocks : [];

    const modelRows =
      methodTabs.length > 0
        ? methodTabs.map((tab) => ({
            name: String(tab.name || "").trim() || "Unknown Model",
            targetPrice: safeTarget(tab.target_price),
            allocationPct: allocationPctFromAmount(tab.investment_amount),
          }))
        : methodBlocks.map((block) => ({
            name: String(block.name || "").trim() || "Unknown Model",
            targetPrice: safeTarget(block.target_price),
            allocationPct: allocationPctFromAmount(block.investment_amount),
          }));

    for (const row of modelRows) {
      applyModel(row.name, row.targetPrice, row.allocationPct);
    }
    applyModel("Overall", overviewTarget, overviewAllocation);

    for (const tab of methodTabs) {
      const outputs = Array.isArray(tab.outputs) ? tab.outputs : [];
      for (const output of outputs) {
        applyValuator(
          String(output.persona || "").trim() || `Output ${output.output_id}`,
          safeTarget(output.target_price),
          allocationPctFromAmount(output.investment_amount),
        );
      }
    }

    const hasDreamTeamOutputs = methodTabs.some(
      (tab) =>
        String(tab.name || "").trim().toLowerCase() === "dream team" &&
        Array.isArray(tab.outputs) &&
        tab.outputs.length > 0,
    );
    if (!hasDreamTeamOutputs) {
      const dreamTeam = Array.isArray(payload.dream_team) ? payload.dream_team : [];
      for (const member of dreamTeam) {
        applyValuator(
          String(member.persona || "").trim() || "Dream Team",
          safeTarget(member.target_price),
          allocationPctFromAmount(member.investment_amount),
        );
      }
    }

    const dashboardAssumptions = buildDashboardAssumptionMeans(payload);
    for (const assumption of dashboardAssumptions) {
      const value = toNumOrNull(assumption.mean);
      if (value === null) continue;
      if (!assumptionsMap.has(assumption.key)) {
        assumptionsMap.set(assumption.key, {
          label: assumption.label,
          acc: { sum: 0, count: 0 },
        });
      }
      const entry = assumptionsMap.get(assumption.key)!;
      entry.acc.sum += value;
      entry.acc.count += 1;
    }
  }

  return {
    coverage: {
      reports_total: reports.length,
      reports_in_window: filtered.length,
      window,
    },
    overview: {
      mean_target_price: mean(overviewAcc.sumTarget, overviewAcc.countTarget),
      mean_allocation_pct: mean(overviewAcc.sumAllocation, overviewAcc.countAllocation),
      mean_disagreement_score: mean(overviewAcc.sumDisagreement, overviewAcc.countDisagreement),
      target_samples: overviewAcc.countTarget,
      allocation_samples: overviewAcc.countAllocation,
      disagreement_samples: overviewAcc.countDisagreement,
    },
    by_model: Array.from(modelMap.entries())
      .map(([key, acc]) => toMeanRow(key, key, acc))
      .sort(compareMeanRows),
    by_valuator: Array.from(valuatorMap.entries())
      .map(([key, acc]) => toMeanRow(key, key, acc))
      .sort(compareMeanRows),
    assumptions: ASSUMPTIONS_ORDER_LABELS
      .map((label) => {
        const key = normalizeLabel(label);
        const entry = assumptionsMap.get(key);
        if (!entry) return null;
        return toAssumptionRow(key, label, entry.acc);
      })
      .filter((row): row is SummaryAssumptionRow => row !== null),
  };
}
