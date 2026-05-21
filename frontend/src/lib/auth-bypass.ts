const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function envFlagEnabled(raw: string | undefined, defaultOn: boolean): boolean {
  if (raw == null) return defaultOn;
  const value = raw.trim().toLowerCase();
  if (["0", "false", "off", "no", ""].includes(value)) return false;
  return true;
}

export function shouldBypassAuthForHostname(hostname: string): boolean {
  // Per-PR Fly preview apps: auth bypassed because Google OAuth doesn't
  // permit wildcard redirect URIs for pr-N-* hostnames. Never set on prod.
  if (envFlagEnabled(process.env.AUTH_BYPASS_PREVIEW, false)) return true;

  if (process.env.NODE_ENV === "production") return false;
  if (!envFlagEnabled(process.env.AUTH_BYPASS_LOCAL, true)) return false;
  return LOCAL_HOSTNAMES.has(String(hostname || "").toLowerCase());
}

export function hostnameFromRequestUrl(url: string): string {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}
