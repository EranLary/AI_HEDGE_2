export type ConsensusComponentKey = "mean" | "median" | "sector_weighted";

export type ConsensusComponentWeight = {
  key: ConsensusComponentKey;
  label: string;
  weight: number;
};

const COMPONENTS: Array<{ key: ConsensusComponentKey; label: string; configured: number }> = [
  { key: "mean", label: "Mean", configured: 0.3 },
  { key: "median", label: "Median", configured: 0.3 },
  { key: "sector_weighted", label: "Sector-Weighted", configured: 0.4 },
];

function finitePositive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function effectiveConsensusWeights(
  rawWeights: Record<string, number> | null | undefined,
  available: Partial<Record<ConsensusComponentKey, boolean>>,
): ConsensusComponentWeight[] {
  const eligible = COMPONENTS.filter((component) => Boolean(available[component.key]));
  if (!eligible.length) return [];

  const supplied = eligible.map((component) => ({
    ...component,
    supplied: finitePositive(rawWeights?.[component.key]),
  }));
  const useSupplied = supplied.some((component) => component.supplied !== null);
  const denominator = supplied.reduce(
    (sum, component) => sum + (useSupplied ? (component.supplied ?? 0) : component.configured),
    0,
  );
  if (denominator <= 0) return [];

  return supplied
    .map((component) => ({
      key: component.key,
      label: component.label,
      weight: (useSupplied ? (component.supplied ?? 0) : component.configured) / denominator,
    }))
    .filter((component) => component.weight > 0);
}

export function formatConsensusWeight(weight: number): string {
  const percent = weight * 100;
  return `${percent.toFixed(Number.isInteger(percent) ? 0 : 2)}%`;
}

export function consensusBlendLabel(weights: ConsensusComponentWeight[]): string {
  return weights.map((component) => `${formatConsensusWeight(component.weight)} ${component.label}`).join(" · ");
}
