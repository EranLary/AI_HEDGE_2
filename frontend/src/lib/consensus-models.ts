import { effectiveConsensusWeights, type ConsensusComponentKey } from "@/lib/consensus-components";
import type { DashboardPayload } from "@/lib/dashboard-types";

export const SIMPLE_MEAN_MODEL_NAME = "Simple Mean";
export const MEDIAN_MODEL_NAME = "Median";
export const SECTOR_WEIGHTED_MODEL_NAME = "Sector-Weighted Valuation";

export type ConsensusModelView = {
  key: ConsensusComponentKey;
  name: typeof SIMPLE_MEAN_MODEL_NAME | typeof MEDIAN_MODEL_NAME | typeof SECTOR_WEIGHTED_MODEL_NAME;
  shortLabel: string;
  targetPrice: number | null;
  investmentAmount: number | null;
  score: number | null;
  targetWeight: number | null;
  allocationWeight: number | null;
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Exposes the three independently measurable inputs to the final consensus.
 * Mean and Median live in the consensus/score contracts rather than method_tabs,
 * so shared analytics use this adapter instead of manufacturing method tabs.
 */
export function consensusModelViews(payload: DashboardPayload): ConsensusModelView[] {
  const consensus = payload.valuation_hub?.consensus || {};
  const card = payload.score_card || payload.decision_card || {};

  const targetByKey: Record<ConsensusComponentKey, number | null> = {
    mean: finiteNumber(consensus.mean_target_price),
    median: finiteNumber(consensus.median_target_price),
    sector_weighted: finiteNumber(
      consensus.sector_weighted_target_price ?? payload.valuation_hub?.sector_weighted_valuation?.target_price,
    ),
  };
  const investmentByKey: Record<ConsensusComponentKey, number | null> = {
    mean: finiteNumber(card.mean_investment_amount_raw ?? card.mean_investment_amount),
    median: finiteNumber(card.median_investment_amount),
    sector_weighted: finiteNumber(
      card.sector_weighted_investment_amount ?? payload.valuation_hub?.sector_weighted_valuation?.investment_amount,
    ),
  };
  const scoreByKey: Record<ConsensusComponentKey, number | null> = {
    mean: finiteNumber(card.mean_score),
    median: finiteNumber(card.median_score),
    sector_weighted: finiteNumber(card.sector_weighted_score),
  };

  const targetWeights = new Map(
    effectiveConsensusWeights(consensus.component_weights, {
      mean: targetByKey.mean !== null,
      median: targetByKey.median !== null,
      sector_weighted: targetByKey.sector_weighted !== null,
    }).map((component) => [component.key, component.weight]),
  );
  const allocationWeights = new Map(
    effectiveConsensusWeights(card.allocation_component_weights, {
      mean: investmentByKey.mean !== null,
      median: investmentByKey.median !== null,
      sector_weighted: investmentByKey.sector_weighted !== null,
    }).map((component) => [component.key, component.weight]),
  );

  const definitions: Array<Pick<ConsensusModelView, "key" | "name" | "shortLabel">> = [
    { key: "sector_weighted", name: SECTOR_WEIGHTED_MODEL_NAME, shortLabel: "Sector-Weighted" },
    { key: "mean", name: SIMPLE_MEAN_MODEL_NAME, shortLabel: SIMPLE_MEAN_MODEL_NAME },
    { key: "median", name: MEDIAN_MODEL_NAME, shortLabel: MEDIAN_MODEL_NAME },
  ];

  return definitions.map((definition) => ({
    ...definition,
    targetPrice: targetByKey[definition.key],
    investmentAmount: investmentByKey[definition.key],
    score: scoreByKey[definition.key],
    targetWeight: targetWeights.get(definition.key) ?? null,
    allocationWeight: allocationWeights.get(definition.key) ?? null,
  }));
}
