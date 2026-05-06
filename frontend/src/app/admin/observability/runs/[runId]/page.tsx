import Link from "next/link";

import { getRun, listCallsForRun } from "@/lib/obs-db";

import RunFlowClient from "./run-flow-client";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const [run, calls] = await Promise.all([getRun(runId), listCallsForRun(runId)]);

  if (!run) {
    return (
      <div>
        <Link href="/admin/observability" style={{ fontSize: 14 }}>
          ← All runs
        </Link>
        <h1 style={{ marginTop: 12 }}>Run not found</h1>
        <p style={{ opacity: 0.7 }}>No obs_runs row matches id {runId}.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link href="/admin/observability" style={{ fontSize: 14 }}>
          ← All runs
        </Link>
        <h1 style={{ fontSize: 24, marginTop: 8 }}>
          {run.ticker}{" "}
          <span style={{ opacity: 0.5, fontSize: 14, fontWeight: 400 }}>
            · {new Date(run.started_at).toLocaleString()}
          </span>
        </h1>
        <div style={{ display: "flex", gap: 24, fontSize: 13, opacity: 0.8, marginTop: 8 }}>
          <span>Status: <strong>{run.status}</strong></span>
          <span>Calls: <strong>{run.total_calls}</strong></span>
          <span>Tokens: <strong>{run.total_tokens_in}↑ / {run.total_tokens_out}↓</strong></span>
          <span>Cost: <strong>${Number(run.total_cost_usd).toFixed(4)}</strong></span>
          <span>Duration: <strong>{run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}</strong></span>
        </div>
        {run.error_message && (
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              maxHeight: 120,
              overflow: "auto",
            }}
          >
            {run.error_message}
          </pre>
        )}
      </div>

      <RunFlowClient calls={calls} />
    </div>
  );
}
