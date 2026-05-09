import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { listRecentRuns } from "@/lib/obs-db";
import { formatCost, formatDuration, formatTokens } from "@/lib/obs-format";

export const dynamic = "force-dynamic";

export default async function ObservabilityRunsPage() {
  const runs = await listRecentRuns(50);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Pipeline runs</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          One row per ticker run. Click a run to see the call hierarchy.
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
            overflow: "auto",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 720 }}>
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
                    <Link href={`/runs/${r.id}`} style={{ fontWeight: 600 }}>
                      {r.ticker}
                    </Link>
                  </Td>
                  <Td><StatusPill status={r.status} /></Td>
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
