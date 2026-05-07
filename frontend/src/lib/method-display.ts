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
  dcf: "DCF",
  "intrinsic dcf": "DCF",
  "net income and p e": "Net Income & P/E",
  "net income p e": "Net Income & P/E",
  "earnings multiple": "Net Income & P/E",
  "revenue and ev s": "Revenue & EV/S",
  "revenue ev s": "Revenue & EV/S",
  "revenue multiple": "Revenue & EV/S",
  "dream team": "Dream Team",
  "bbb target": "BBB Target",
  "target scenario": "BBB Target",
  "bbb ni and p e": "BBB NI & P/E",
  "bbb ni p e": "BBB NI & P/E",
  "earnings scenario": "BBB NI & P/E",
  "larys logic": "Lary's Logic",
  "laries logic": "Lary's Logic",
  "composite logic": "Lary's Logic",
  overall: "Overall",
};

export function canonicalModelName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown Model";
  const key = normalizeModelKey(raw);
  return MODEL_NAME_ALIASES[key] || raw;
}

