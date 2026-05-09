// Phase 0.1 seam: returns either the existing local /api/artifacts/... URL or
// an R2-backed URL once the runner starts populating r2_keys. The R2 branch
// stays dormant until R2_PUBLIC_BASE_URL is set in the environment (Phase 0.6 / 1).

export function getArtifactUrl(
  ticker: string,
  kind: string,
  r2Keys?: Record<string, string> | null,
): string {
  const r2 = r2Keys?.[kind];
  const base = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (r2 && base) {
    if (r2.startsWith("http://") || r2.startsWith("https://")) {
      return r2;
    }
    const cleanedBase = base.replace(/\/+$/, "");
    const cleanedKey = r2.replace(/^\/+/, "");
    return `${cleanedBase}/${cleanedKey}`;
  }
  return `/api/artifacts/${encodeURIComponent(ticker)}/${kind}`;
}
