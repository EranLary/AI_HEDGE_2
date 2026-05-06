export const LEGACY_METHOD_TO_CANONICAL: Record<string, string> = {
  DCF: "Intrinsic DCF",
  "Net Income & P/E": "Earnings Multiple",
  "Revenue & EV/S": "Revenue Multiple",
  "Dream Team": "Dream Team",
  "BBB Target": "Target Scenario",
  "BBB NI & P/E": "Earnings Scenario",
  "Lary's Logic": "Composite Logic",
};

export const CANONICAL_METHOD_ORDER: string[] = [
  LEGACY_METHOD_TO_CANONICAL.DCF,
  LEGACY_METHOD_TO_CANONICAL["Net Income & P/E"],
  LEGACY_METHOD_TO_CANONICAL["Revenue & EV/S"],
  LEGACY_METHOD_TO_CANONICAL["Dream Team"],
  LEGACY_METHOD_TO_CANONICAL["BBB Target"],
  LEGACY_METHOD_TO_CANONICAL["BBB NI & P/E"],
  LEGACY_METHOD_TO_CANONICAL["Lary's Logic"],
];

const aliasToCanonical = new Map<string, string>(
  Object.entries(LEGACY_METHOD_TO_CANONICAL).flatMap(([legacy, canonical]) => [
    [legacy, canonical],
    [canonical, canonical],
  ]),
);

export function canonicalMethodName(value: unknown): string {
  const key = String(value || "").trim();
  if (!key) return "";
  return aliasToCanonical.get(key) || key;
}
