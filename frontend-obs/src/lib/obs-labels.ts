import type { ObsCallSummaryRow } from "@/lib/obs-db";

export function callLabel(call: ObsCallSummaryRow): string {
  if (call.call_site) return call.call_site;
  if (call.persona) return call.persona;
  return `${call.stage} #${call.sequence}`;
}

const FENCE_RE = /^(```|~~~)/;
const PERSONA_PREFIX_RE =
  /^(you'?re|you are|act as|assume the role|imagine you'?re|please act|consider yourself|as an?\s+\w+,)/i;
const POLITE_PREFIX_RE =
  /^(please|kindly|now|then|first,?|finally,?|next,?|can you|could you|would you|i'?d like you to|i want you to|let'?s|let me|your task is to|your job is to)\s+/i;
const ACTION_VERB_RE =
  /^(provide|generate|analy[sz]e|calculate|compute|write|estimate|determine|explain|compare|review|summari[sz]e|list|identify|extract|describe|outline|return|give|create|produce|compose|draft|build|design|propose|suggest|recommend|evaluate|assess|critique|examine|find|show|demonstrate|tell|answer|respond|reply|focus|score|rate|rank|select|choose|pick|decide|judge|conclude|forecast|project|model|value|verify|check|validate|map|fetch|retrieve|search|infer)\b/i;

const VERBOSE_PREFIX_RE =
  /^(provide(?:\s+me)?(?:\s+with)?|generate|create|produce|return|give(?:\s+me)?|tell(?:\s+me)?|show(?:\s+me)?|write|draft|build|design|please|kindly)\s+/i;
const ARTICLE_PREFIX_RE = /^(the|a|an)\s+/i;

function condense(s: string, maxWords: number): string {
  let out = s;
  out = out.replace(VERBOSE_PREFIX_RE, "");
  out = out.replace(ARTICLE_PREFIX_RE, "");
  out = out.replace(/^\s*(of|on|for|in|with|about)\s+/i, "");
  const words = out.split(/\s+/).filter(Boolean);
  if (words.length === 0) return s;
  const trimmed = words.slice(0, maxWords).join(" ");
  return capitalize(trimmed);
}

/** Derive a short human-friendly title from the prompt content. */
export function derivePromptTitle(
  prompt: string | null | undefined,
  maxLen = 50,
  maxWords = 5,
): string | null {
  if (!prompt) return null;
  const text = prompt.slice(0, 4000);
  const rawLines = text.split(/\r?\n/);

  // 1. Strongest signal: a markdown heading anywhere near the top.
  let inFence = false;
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line === "---" || line.startsWith("---")) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) return truncate(stripTrailingPunct(heading[1].trim()), maxLen);
  }

  // 2. Collect first ~6 sentences (skipping fences / dividers).
  const sentences: string[] = [];
  inFence = false;
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line === "---" || line.startsWith("---")) continue;
    const bullet = /^([-*+]|\d+\.)\s+(.+)$/.exec(line);
    const cleaned = bullet ? bullet[2] : line;
    for (const part of cleaned.split(/(?<=[.!?])\s+/)) {
      const s = stripPolite(part.trim());
      if (s) sentences.push(s);
      if (sentences.length >= 6) break;
    }
    if (sentences.length >= 6) break;
  }

  // 3. Prefer a sentence starting with an imperative verb (the actual ask).
  for (const s of sentences) {
    if (PERSONA_PREFIX_RE.test(s)) continue;
    if (ACTION_VERB_RE.test(s)) {
      return truncate(stripTrailingPunct(condense(s, maxWords)), maxLen);
    }
  }

  // 4. Otherwise: first non-persona sentence.
  for (const s of sentences) {
    if (PERSONA_PREFIX_RE.test(s)) continue;
    return truncate(stripTrailingPunct(condense(s, maxWords)), maxLen);
  }

  // 5. Ultimate fallback: first sentence (even if it's a persona setup).
  if (sentences.length > 0)
    return truncate(stripTrailingPunct(condense(sentences[0], maxWords)), maxLen);
  return null;
}

function stripPolite(s: string): string {
  let out = s;
  while (POLITE_PREFIX_RE.test(out)) {
    out = out.replace(POLITE_PREFIX_RE, "");
  }
  return out;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripTrailingPunct(s: string): string {
  return s.replace(/[\s.,;:!?—–\-]+$/, "");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/[\s.,;:—–\-]+$/, "") + "…";
}

// Domain classifier: maps (stage, distinctive prompt phrases) -> a clean label.
// Listed most-specific-first; first match wins. Within a stage, if nothing
// specific matches we fall back to a generic per-stage label.
type ClassifyRule = {
  stages: string[];
  match: RegExp[];
  label: string;
};

const PROMPT_RULES: ClassifyRule[] = [
  // analyst stage variants
  { stages: ["analyst"], match: [/investment thesis/i, /writing[\s\S]{0,40}original/i], label: "Investment thesis" },
  { stages: ["analyst"], match: [/market strategist/i, /industry analysis/i, /competitive dynamics/i], label: "Industry analysis" },
  { stages: ["analyst"], match: [/fundamental[\s\S]{0,30}analysis/i, /capital allocation/i], label: "Fundamental analysis" },
  { stages: ["analyst"], match: [/.+/], label: "Investment analysis" },

  // technical
  { stages: ["technical"], match: [/.+/], label: "Technical signals" },

  // valuations
  { stages: ["valuations", "valuation"], match: [/decision[\- ]grade/i, /portfolio manager/i, /buy-side decision/i], label: "Buy-side decision" },
  { stages: ["valuations", "valuation"], match: [/\bDCF\b|discounted cash flow/i], label: "DCF valuation" },
  { stages: ["valuations", "valuation"], match: [/dividend discount|\bDDM\b/i], label: "Dividend discount" },
  { stages: ["valuations", "valuation"], match: [/relative valuation|comparable compan/i], label: "Relative valuation" },
  { stages: ["valuations", "valuation"], match: [/.+/], label: "Valuation" },

  // dashboard
  { stages: ["dashboard.extract", "dashboard"], match: [/.+/], label: "Dashboard writeup" },

  // sec.short
  { stages: ["sec.short"], match: [/earnings quality|accounting distortion/i], label: "Earnings quality" },
  { stages: ["sec.short"], match: [/10[\- ]?K|10[\- ]?Q|footnotes/i], label: "10-K deep dive" },
  { stages: ["sec.short"], match: [/.+/], label: "SEC short read" },

  // sec.qa
  { stages: ["sec.qa"], match: [/diligence/i, /critical questions/i], label: "Diligence questions" },
  { stages: ["sec.qa"], match: [/answer each question|SEC filing text/i], label: "SEC filing answers" },
  { stages: ["sec.qa"], match: [/.+/], label: "SEC Q&A" },

  // persona personas
  { stages: ["persona.buffett"], match: [/.+/], label: "Buffett take" },
  { stages: ["persona.munger"], match: [/.+/], label: "Munger take" },
];

/** Match the prompt + stage against the domain rules. Returns null when nothing fits. */
export function classifyPrompt(
  stage: string | null | undefined,
  prompt: string | null | undefined,
): string | null {
  if (!stage) return null;
  const text = (prompt ?? "").slice(0, 3000);
  for (const rule of PROMPT_RULES) {
    if (!rule.stages.includes(stage)) continue;
    if (rule.match.some((re) => re.test(text))) return rule.label;
  }
  return null;
}

/** Preferred display name for a call: domain classifier first, then prompt heading,
 * then first-sentence extraction, then the technical callLabel. */
export function callTitle(call: ObsCallSummaryRow): string {
  const classified = classifyPrompt(call.stage, call.prompt);
  if (classified) return classified;
  const fromPrompt = derivePromptTitle(call.prompt);
  if (fromPrompt) return fromPrompt;
  return callLabel(call);
}

const STAGE_NAMES: Record<string, string> = {
  analyst: "Analyst review",
  "sec.qa": "SEC filings Q&A",
  "sec.short": "SEC short read",
  "dashboard.extract": "Dashboard extraction",
  valuations: "Valuations",
  "valuation.dcf": "DCF valuation",
  "valuation.ddm": "Dividend discount",
  "valuation.relative": "Relative valuation",
  technical: "Technical analysis",
  "persona.buffett": "Buffett persona",
  "persona.munger": "Munger persona",
  unknown: "Other",
};

/** Human-readable label for a stage code. Falls back to a title-cased version. */
export function stageDisplayName(stage: string | null | undefined): string {
  if (!stage) return "Other";
  const direct = STAGE_NAMES[stage];
  if (direct) return direct;
  // Auto: split on dots/underscores, capitalize first segment, lowercase rest
  const parts = stage.split(/[._]/).filter(Boolean);
  if (parts.length === 0) return stage;
  const head = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
  if (parts.length === 1) return head;
  const tail = parts.slice(1).map((p) => p.toLowerCase()).join(" ");
  return `${head} · ${tail}`;
}
