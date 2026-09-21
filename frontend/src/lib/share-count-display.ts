import type { ShareCountResolution } from "@/lib/dashboard-types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function finiteShareCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeShareCountResolution(
  value: unknown,
  finalFallback: unknown,
): ShareCountResolution | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const rawCandidates = asRecord(raw.provider_candidates);
  const providerCandidates: Record<string, number> = {};
  for (const key of [
    "current_valuation_denominator",
    "provider_implied_shares",
    "market_cap_div_current_price",
  ]) {
    const candidate = finiteShareCount(rawCandidates?.[key]);
    if (candidate !== null) providerCandidates[key] = candidate;
  }

  const selected = finiteShareCount(raw.selected_shares_outstanding) ?? finiteShareCount(finalFallback);
  if (selected === null) return null;
  const original =
    finiteShareCount(raw.original_yahoo_shares) ??
    finiteShareCount(providerCandidates.current_valuation_denominator);
  const changed = original === null ? null : Math.abs(selected - original) > 0.5;
  return {
    status: textValue(raw.status) || "unavailable",
    selected_shares_outstanding: selected,
    original_yahoo_shares: original,
    changed_from_yahoo: changed,
    source_type: textValue(raw.source_type) || "unavailable",
    basis: textValue(raw.basis),
    as_of_date: textValue(raw.as_of_date) || null,
    evidence_excerpt: textValue(raw.evidence_excerpt),
    calculation: textValue(raw.calculation),
    confidence: textValue(raw.confidence) || "Low",
    fallback_used: raw.fallback_used === true,
    validation_note: textValue(raw.validation_note),
    provider_candidates: providerCandidates,
  };
}

function markdownField(section: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = section.match(new RegExp(`^- ${escaped}:\\s*(.+?)\\s*$`, "im"));
  return match?.[1]?.trim() || "";
}

export function shareCountResolutionFromAnalysisMarkdown(
  markdown: unknown,
  finalFallback: unknown,
): ShareCountResolution | null {
  if (typeof markdown !== "string" || !markdown.trim()) return null;
  const heading = /^## Verified Share Count for Valuation\s*$/im.exec(markdown);
  if (!heading || typeof heading.index !== "number") return null;
  const sectionStart = heading.index + heading[0].length;
  const remaining = markdown.slice(sectionStart);
  const nextHeading = remaining.search(/\r?\n##\s+/);
  const section = nextHeading >= 0 ? remaining.slice(0, nextHeading) : remaining;

  const selectedText = markdownField(section, "Selected total-company shares");
  const selectedParsed = Number(selectedText.replace(/[^0-9.]/g, ""));
  const selected = finiteShareCount(selectedParsed) ?? finiteShareCount(finalFallback);
  if (selected === null) return null;

  const status = markdownField(section, "Status") || "unavailable";
  const sourceType = markdownField(section, "Source") || "unavailable";
  const basis = markdownField(section, "Basis");
  const asOfText = markdownField(section, "As-of date");
  const validationNote = markdownField(section, "Fallback note");
  const original = basis === "current_valuation_denominator" ? selected : null;

  return {
    status,
    selected_shares_outstanding: selected,
    original_yahoo_shares: original,
    changed_from_yahoo: original === null ? null : Math.abs(selected - original) > 0.5,
    source_type: sourceType,
    basis,
    as_of_date: asOfText && asOfText.toLowerCase() !== "not stated" ? asOfText : null,
    evidence_excerpt: "",
    calculation: "",
    confidence: markdownField(section, "Confidence") || "Low",
    fallback_used: status === "fallback" || sourceType === "provider_fallback",
    validation_note: validationNote,
    provider_candidates: original === null ? {} : { current_valuation_denominator: original },
  };
}

export function resolvedShareCount(
  finalValue: unknown,
  resolution?: ShareCountResolution | null,
): number | null {
  return finiteShareCount(resolution?.selected_shares_outstanding) ?? finiteShareCount(finalValue);
}

export function shareCountChanged(resolution?: ShareCountResolution | null): boolean {
  if (typeof resolution?.changed_from_yahoo === "boolean") return resolution.changed_from_yahoo;
  const finalValue = finiteShareCount(resolution?.selected_shares_outstanding);
  const originalValue = finiteShareCount(resolution?.original_yahoo_shares);
  if (finalValue === null || originalValue === null) return false;
  return Math.abs(finalValue - originalValue) > 0.5;
}

export function formatCompactShares(value: unknown): string {
  const count = finiteShareCount(value);
  if (count === null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(count);
}

export function formatFullShares(value: unknown): string {
  const count = finiteShareCount(value);
  if (count === null) return "N/A";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(count);
}

export function shareCountDelta(resolution?: ShareCountResolution | null): {
  count: number;
  percent: number;
} | null {
  const finalValue = finiteShareCount(resolution?.selected_shares_outstanding);
  const originalValue = finiteShareCount(resolution?.original_yahoo_shares);
  if (finalValue === null || originalValue === null) return null;
  return {
    count: finalValue - originalValue,
    percent: ((finalValue - originalValue) / originalValue) * 100,
  };
}
