export function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // noop
  }
  return null;
}

export function parseJsonObjectFromMixedOutput(stdout: string): Record<string, unknown> | null {
  const direct = tryParseJsonObject(stdout || "{}");
  if (direct) return direct;

  const text = String(stdout || "");
  const end = text.lastIndexOf("}");
  if (end < 0) return null;

  let start = text.lastIndexOf("{", end);
  while (start >= 0) {
    const candidate = text.slice(start, end + 1).trim();
    const parsed = tryParseJsonObject(candidate);
    if (parsed) return parsed;
    start = text.lastIndexOf("{", start - 1);
  }

  return null;
}
