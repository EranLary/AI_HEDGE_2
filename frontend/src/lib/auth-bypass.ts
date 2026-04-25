const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function envFlagEnabled(raw: string | undefined): boolean {
  const value = String(raw ?? "1").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

export function shouldBypassAuthForHostname(hostname: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (!envFlagEnabled(process.env.AUTH_BYPASS_LOCAL)) return false;
  return LOCAL_HOSTNAMES.has(String(hostname || "").toLowerCase());
}

export function hostnameFromRequestUrl(url: string): string {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}
