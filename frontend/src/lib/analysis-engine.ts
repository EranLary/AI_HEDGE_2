export const ANALYSIS_ENGINES = ["deterministic_v1", "hybrid_v1"] as const;

export type AnalysisEngineId = (typeof ANALYSIS_ENGINES)[number];

export const DEFAULT_ANALYSIS_ENGINE: AnalysisEngineId = "deterministic_v1";

export function isAnalysisEngine(value: unknown): value is AnalysisEngineId {
  return ANALYSIS_ENGINES.includes(String(value || "") as AnalysisEngineId);
}

export function hybridAnalysisEnabled(): boolean {
  return (
    process.env.HYBRID_RUN_ANALYSIS_ENABLED === "1" ||
    process.env.NEXT_PUBLIC_HYBRID_RUN_ANALYSIS_ENABLED === "1"
  );
}
