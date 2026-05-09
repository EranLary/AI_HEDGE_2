import type { ObsCallRow } from "@/lib/obs-db";

export const LEGACY_SYSTEM_PROMPT = "Answer clearly and concisely.";

/**
 * Split the stored prompt into the System and User parts the UI shows.
 *
 * Today the DB stores a single `prompt` string (the user message) and the
 * system message is hardcoded in the Python writer. Surface the legacy
 * system text as a placeholder so the UI structure is correct now; once
 * `system_prompt` / `user_prompt` columns exist this becomes a one-line
 * change.
 */
export function splitPrompt(call: Pick<ObsCallRow, "prompt">): {
  system: string | null;
  user: string | null;
} {
  return { system: LEGACY_SYSTEM_PROMPT, user: call.prompt };
}
