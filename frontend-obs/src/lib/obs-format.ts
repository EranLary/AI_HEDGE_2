export function formatCost(usd: string | number | null | undefined, precision = 4): string {
  if (usd == null) return "—";
  const n = typeof usd === "number" ? usd : Number(usd);
  if (!isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n < 0.001) return "<$0.001";
  return `$${n.toFixed(precision)}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}
