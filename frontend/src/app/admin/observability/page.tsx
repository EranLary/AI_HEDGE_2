import Link from "next/link";

import { listRecentRuns } from "@/lib/obs-db";

export const dynamic = "force-dynamic";

function formatCost(usd: string | null | undefined): string {
  if (usd == null) return "—";
  const n = Number(usd);
  if (!isFinite(n)) return "—";
  if (n < 0.001) return "<$0.001";
  return `$${n.toFixed(4)}`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function formatTokens(n: number | null): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function statusPill(status: string) {
  const map: Record<string, { bg: string; fg: string }> = {
    running: { bg: "rgba(99,102,241,0.18)", fg: "#a5b4fc" },
    success: { bg: "rgba(34,197,94,0.18)", fg: "#86efac" },
    error:   { bg: "rgba(239,68,68,0.18)", fg: "#fca5a5" },
  };
  const style = map[status] ?? { bg: "rgba(148,163,184,0.18)", fg: "#cbd5e1" };
  return (
    <span
      style={{
        background: style.bg,
        color: style.fg,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {status}
    </span>
  );
}

export default async function ObservabilityRunsPage() {
  const runs = await listRecentRuns(50);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Pipeline runs</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          One row per ticker run. Click a run to see the call DAG.
        </p>
      </div>

      {runs.length === 0 ? (
        <div
          style={{
            padding: 32,
            border: "1px dashed var(--color-border)",
            borderRadius: 8,
            opacity: 0.7,
            fontSize: 14,
          }}
        >
          No runs recorded yet. Start a ticker run via the CLI or site —
          it will appear here.
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "var(--color-muted, rgba(0,0,0,0.04))" }}>
                <Th>Ticker</Th>
                <Th>Status</Th>
                <Th>Started</Th>
                <Th align="right">Duration</Th>
                <Th align="right">Calls</Th>
                <Th align="right">Tokens in / out</Th>
                <Th align="right">Cost</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <Td>
                    <Link
                      href={`/admin/observability/runs/${r.id}`}
                      style={{ fontWeight: 600 }}
                    >
                      {r.ticker}
                    </Link>
                  </Td>
                  <Td>{statusPill(r.status)}</Td>
                  <Td>{new Date(r.started_at).toLocaleString()}</Td>
                  <Td align="right">{formatDuration(r.duration_ms)}</Td>
                  <Td align="right">{r.total_calls}</Td>
                  <Td align="right">
                    {formatTokens(r.total_tokens_in)} / {formatTokens(r.total_tokens_out)}
                  </Td>
                  <Td align="right">{formatCost(r.total_cost_usd)}</Td>
                  <Td>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>{r.source}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "10px 14px",
        fontWeight: 500,
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        opacity: 0.7,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td style={{ textAlign: align ?? "left", padding: "10px 14px", verticalAlign: "middle" }}>
      {children}
    </td>
  );
}
