function normalizeModelKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MODEL_NAME_ALIASES: Record<string, string> = {
  dcf: "Intrinsic DCF",
  "intrinsic dcf": "Intrinsic DCF",
  "net income and p e": "Earnings Multiple",
  "net income p e": "Earnings Multiple",
  "earnings multiple": "Earnings Multiple",
  "revenue and ev s": "Revenue Multiple",
  "revenue ev s": "Revenue Multiple",
  "revenue multiple": "Revenue Multiple",
  "dream team": "Dream Team",
  "bbb target": "Target Scenario",
  "target scenario": "Target Scenario",
  "bbb ni and p e": "Earnings Scenario",
  "bbb ni p e": "Earnings Scenario",
  "earnings scenario": "Earnings Scenario",
  "larys logic": "Composite Logic",
  "laries logic": "Composite Logic",
  "composite logic": "Composite Logic",
  overall: "Overall",
};

export function canonicalModelName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown Model";
  const key = normalizeModelKey(raw);
  return MODEL_NAME_ALIASES[key] || raw;
}
