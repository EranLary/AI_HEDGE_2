import type { DashboardPayload } from "./dashboard-types";
import { canonicalMethodName } from "./method-names";
import {
  actualDirectionFromPrices,
  allocationDirectionFromAmount,
  applyVerdict,
  createAccumulator,
  finalizeAccumulator,
  mergeAccumulators,
  targetDirectionWithFloor,
  verdictFromDirections,
  type HitRateAccumulator,
} from "./hit-rate-utils";

export type HitRateSourceReport = {
  ticker: string;
  payload: DashboardPayload;
};

export type MetricCounts = {
  hits: number;
  misses: number;
  neutral: number;
  considered: number;
  hit_rate_pct: number | null;
};

export type MetricCountsSet = {
  targets: MetricCounts;
  allocations: MetricCounts;
  combined: MetricCounts;
};

export type HitRateRow = {
  key: string;
  label: string;
  targets: MetricCounts;
  allocations: MetricCounts;
  combined: MetricCounts;
};

type MetricAccSet = {
  targets: HitRateAccumulator;
  allocations: HitRateAccumulator;
};

export type HitRateCoverage = {
  reports_scanned: number;
  reports_with_baseline_price: number;
  tickers_covered: number;
  tickers_with_live_price: number;
  predictions_total: number;
  predictions_considered: number;
  predictions_neutral: number;
};

export type HitRateAggregation = {
  coverage: HitRateCoverage;
  overview: MetricCountsSet;
  by_model: HitRateRow[];
  by_valuator: HitRateRow[];
};

function createMetricSet(): MetricAccSet {
  return {
    targets: createAccumulator(),
    allocations: createAccumulator(),
  };
}

function toNumOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowFromMetricSet(key: string, label: string, metric: MetricAccSet): HitRateRow {
  const targets = finalizeAccumulator(metric.targets);
  const allocations = finalizeAccumulator(metric.allocations);
  const combined = finalizeAccumulator(mergeAccumulators(metric.targets, metric.allocations));
  return { key, label, targets, allocations, combined };
}

function compareRows(a: HitRateRow, b: HitRateRow): number {
  const aRate = a.combined.hit_rate_pct;
  const bRate = b.combined.hit_rate_pct;
  if (aRate === null && bRate !== null) return 1;
  if (aRate !== null && bRate === null) return -1;
  if (aRate !== null && bRate !== null && bRate !== aRate) return bRate - aRate;
  if (b.combined.considered !== a.combined.considered) return b.combined.considered - a.combined.considered;
  return a.label.localeCompare(b.label);
}

function isPlaceholderValuatorLabel(label: string): boolean {
  return /^output\s+\d+$/i.test(String(label || "").trim());
}

function applyPrediction(metric: MetricAccSet, type: "target" | "allocation", predictedDirection: -1 | 0 | 1 | null, actualDirection: -1 | 0 | 1 | null): void {
  const verdict = verdictFromDirections(predictedDirection, actualDirection);
  if (type === "target") {
    applyVerdict(metric.targets, verdict);
    return;
  }
  applyVerdict(metric.allocations, verdict);
}

function finalizeMetricSet(metric: MetricAccSet): MetricCountsSet {
  const targets = finalizeAccumulator(metric.targets);
  const allocations = finalizeAccumulator(metric.allocations);
  const combined = finalizeAccumulator(mergeAccumulators(metric.targets, metric.allocations));
  return { targets, allocations, combined };
}

export function computeHitRateAggregation(
  reports: HitRateSourceReport[],
  livePriceByTicker: Map<string, number | null>,
): HitRateAggregation {
  const uniqueTickers = Array.from(new Set(reports.map((r) => String(r.ticker || "").toUpperCase()).filter(Boolean)));

  const overview = createMetricSet();
  const byModelMap = new Map<string, MetricAccSet>();
  const byValuatorMap = new Map<string, MetricAccSet>();

  let reportsWithBaselinePrice = 0;

  for (const report of reports) {
    const payload = report.payload;
    const ticker = String(report.ticker || "").toUpperCase();
    const reportPrice = toNumOrNull(payload.valuation_hub?.consensus?.current_price);
    if (typeof reportPrice === "number") {
      reportsWithBaselinePrice += 1;
    }
    const liveCurrent = livePriceByTicker.get(ticker) ?? null;
    const actualDirection = actualDirectionFromPrices(liveCurrent, reportPrice);

    const methodTabs = Array.isArray(payload.valuation_hub?.method_tabs) ? payload.valuation_hub.method_tabs : [];
    const methodBlocks = Array.isArray(payload.valuation_hub?.method_blocks) ? payload.valuation_hub.method_blocks : [];

    const modelRows =
      methodTabs.length > 0
        ? methodTabs.map((tab) => ({
            name: canonicalMethodName(tab.name) || String(tab.name || "").trim() || "Unknown Model",
            target_price: toNumOrNull(tab.target_price),
            investment_amount: toNumOrNull(tab.investment_amount),
          }))
        : methodBlocks.map((block) => ({
            name: canonicalMethodName(block.name) || String(block.name || "").trim() || "Unknown Model",
            target_price: toNumOrNull(block.target_price),
            investment_amount: toNumOrNull(block.investment_amount),
          }));

    const applyModelPrediction = (modelKey: string, targetPrice: number | null, investmentAmount: number | null) => {
      if (!byModelMap.has(modelKey)) {
        byModelMap.set(modelKey, createMetricSet());
      }
      const modelMetric = byModelMap.get(modelKey)!;

      const targetDirection = targetDirectionWithFloor(targetPrice, reportPrice);
      const allocationDirection = allocationDirectionFromAmount(investmentAmount);

      applyPrediction(modelMetric, "target", targetDirection, actualDirection);
      applyPrediction(modelMetric, "allocation", allocationDirection, actualDirection);
      applyPrediction(overview, "target", targetDirection, actualDirection);
      applyPrediction(overview, "allocation", allocationDirection, actualDirection);
    };

    for (const modelRow of modelRows) {
      applyModelPrediction(modelRow.name, modelRow.target_price, modelRow.investment_amount);
    }

    const overallMeanTarget = toNumOrNull(payload.valuation_hub?.consensus?.mean_target_price);
    const overallMeanInvestment = toNumOrNull(payload.decision_card?.mean_investment_amount);
    if (overallMeanTarget !== null || overallMeanInvestment !== null) {
      applyModelPrediction("Overall", overallMeanTarget, overallMeanInvestment);
    }

    for (const tab of methodTabs) {
      const outputs = Array.isArray(tab.outputs) ? tab.outputs : [];
      for (const output of outputs) {
        const targetDirection = targetDirectionWithFloor(toNumOrNull(output.target_price), reportPrice);
        const allocationDirection = allocationDirectionFromAmount(toNumOrNull(output.investment_amount));

        applyPrediction(overview, "target", targetDirection, actualDirection);
        applyPrediction(overview, "allocation", allocationDirection, actualDirection);

        const persona = String(output.persona || "").trim() || `Output ${output.output_id}`;
        if (isPlaceholderValuatorLabel(persona)) {
          continue;
        }
        if (!byValuatorMap.has(persona)) {
          byValuatorMap.set(persona, createMetricSet());
        }
        const valuatorMetric = byValuatorMap.get(persona)!;
        applyPrediction(valuatorMetric, "target", targetDirection, actualDirection);
        applyPrediction(valuatorMetric, "allocation", allocationDirection, actualDirection);
      }
    }

    const hasDreamTeamOutputs = methodTabs.some(
      (tab) => canonicalMethodName(tab.name).toLowerCase() === "dream team" && Array.isArray(tab.outputs) && tab.outputs.length > 0,
    );
    if (!hasDreamTeamOutputs) {
      const dreamTeam = Array.isArray(payload.dream_team) ? payload.dream_team : [];
      for (const member of dreamTeam) {
        const persona = String(member.persona || "").trim() || "Dream Team";
        if (!byValuatorMap.has(persona)) {
          byValuatorMap.set(persona, createMetricSet());
        }
        const valuatorMetric = byValuatorMap.get(persona)!;

        const targetDirection = targetDirectionWithFloor(toNumOrNull(member.target_price), reportPrice);
        const allocationDirection = allocationDirectionFromAmount(toNumOrNull(member.investment_amount));

        applyPrediction(valuatorMetric, "target", targetDirection, actualDirection);
        applyPrediction(valuatorMetric, "allocation", allocationDirection, actualDirection);
        applyPrediction(overview, "target", targetDirection, actualDirection);
        applyPrediction(overview, "allocation", allocationDirection, actualDirection);
      }
    }
  }

  const overviewFinal = finalizeMetricSet(overview);

  const by_model = Array.from(byModelMap.entries())
    .map(([key, metric]) => rowFromMetricSet(key, key, metric))
    .sort(compareRows);
  const by_valuator = Array.from(byValuatorMap.entries())
    .map(([key, metric]) => rowFromMetricSet(key, key, metric))
    .sort(compareRows);

  const predictionsTotal = overviewFinal.combined.hits + overviewFinal.combined.misses + overviewFinal.combined.neutral;

  return {
    coverage: {
      reports_scanned: reports.length,
      reports_with_baseline_price: reportsWithBaselinePrice,
      tickers_covered: uniqueTickers.length,
      tickers_with_live_price: Array.from(livePriceByTicker.values()).filter((v) => typeof v === "number").length,
      predictions_total: predictionsTotal,
      predictions_considered: overviewFinal.combined.considered,
      predictions_neutral: overviewFinal.combined.neutral,
    },
    overview: overviewFinal,
    by_model,
    by_valuator,
  };
}
