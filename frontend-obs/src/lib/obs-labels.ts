import type { ObsCallRow } from "@/lib/obs-db";

export function callLabel(call: ObsCallRow): string {
  if (call.call_site) return call.call_site;
  if (call.persona) return call.persona;
  return `${call.stage} #${call.sequence}`;
}

const FENCE_RE = /^(```|~~~)/;

/** Derive a short human-friendly title from the prompt content. */
export function derivePromptTitle(
  prompt: string | null | undefined,
  maxLen = 38,
): string | null {
  if (!prompt) return null;
  const text = prompt.slice(0, 2000);
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line === "---" || line.startsWith("---")) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) return truncate(heading[1].trim(), maxLen);
    const bullet = /^([-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (bullet) return truncate(firstSentence(bullet[2]), maxLen);
    return truncate(firstSentence(line), maxLen);
  }
  return null;
}

function firstSentence(line: string): string {
  const stop = line.search(/[.!?](\s|$)/);
  if (stop > 0) return line.slice(0, stop + 1);
  return line;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/[\s.,;:—–\-]+$/, "") + "…";
}

/** Preferred display name for a call: prompt-derived title, falling back to callLabel. */
export function callTitle(call: ObsCallRow): string {
  const fromPrompt = derivePromptTitle(call.prompt);
  if (fromPrompt) return fromPrompt;
  return callLabel(call);
}
