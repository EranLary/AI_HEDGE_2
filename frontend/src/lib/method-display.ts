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
  dcf: "Scenario DCF",
  "intrinsic dcf": "Scenario DCF",
  "scenario dcf": "Scenario DCF",
  "scenario dcf valuation": "Scenario DCF",
  "scenario dcf price valuation": "Scenario DCF",
  "scenario dcf price": "Scenario DCF",
  "net income and p e": "Earnings Scenario",
  "net income p e": "Earnings Scenario",
  "earnings multiple": "Earnings Scenario",
  "earnings scenario": "Earnings Scenario",
  "revenue and ev s": "Revenue Scenario",
  "revenue ev s": "Revenue Scenario",
  "revenue multiple": "Revenue Scenario",
  "revenue scenario": "Revenue Scenario",
  "dream team": "Dream Team",
  "bbb target": "Target Scenario",
  "target scenario": "Target Scenario",
  "bbb ni and p e": "Earnings Scenario",
  "bbb ni p e": "Earnings Scenario",
  "larys logic": "Composite Scenario",
  "laries logic": "Composite Scenario",
  "composite logic": "Composite Scenario",
  "composite scenario": "Composite Scenario",
  "composite scenario valuation": "Composite Scenario",
  sotp: "SOTP Scenario",
  "sotp scenario": "SOTP Scenario",
  "sotp scenario valuation": "SOTP Scenario",
  "target scenario valuation": "Target Scenario",
  "earnings scenario valuation": "Earnings Scenario",
  "revenue scenario valuation": "Revenue Scenario",
  overall: "Overall",
};

export function canonicalModelName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown Model";
  const key = normalizeModelKey(raw);
  return MODEL_NAME_ALIASES[key] || raw;
}
