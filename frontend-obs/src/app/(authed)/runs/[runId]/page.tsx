import Link from "next/link";

import { ResizablePanel } from "@/components/resizable-panel";
import { getRun, listCallsForRun } from "@/lib/obs-db";
import { formatCost, formatDuration, formatTokens } from "@/lib/obs-format";

import { CallPanelContent, PanelTitle } from "./call-panel";
import { callLabel } from "./call-tree";
import RunFlowClient from "./run-flow-client";
import { RunHierarchy } from "./run-hierarchy";
import { RunTabs } from "./run-tabs";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams?: Promise<{ view?: string; call?: string }>;
}) {
  const { runId } = await params;
  const sp = (await searchParams) ?? {};
  const view: "flow" | "hierarchy" = sp.view === "flow" ? "flow" : "hierarchy";
  const activeCallId = sp.call ?? null;

  const [run, calls] = await Promise.all([getRun(runId), listCallsForRun(runId)]);

  if (!run) {
    return (
      <div>
        <Link href="/runs" style={{ fontSize: 14 }}>
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
        <Link href="/runs" style={{ fontSize: 14 }}>
          ← All runs
        </Link>
        <h1 style={{ fontSize: 24, marginTop: 8 }}>
          {run.ticker}{" "}
          <span style={{ opacity: 0.5, fontSize: 14, fontWeight: 400 }}>
            · {new Date(run.started_at).toLocaleString()}
          </span>
        </h1>
        <div style={{ display: "flex", gap: 24, fontSize: 13, opacity: 0.8, marginTop: 8, flexWrap: "wrap" }}>
          <span>Status: <strong>{run.status}</strong></span>
          <span>Calls: <strong>{run.total_calls}</strong></span>
          <span>Tokens: <strong>{formatTokens(run.total_tokens_in)}↑ / {formatTokens(run.total_tokens_out)}↓</strong></span>
          <span>Cost: <strong>{formatCost(run.total_cost_usd)}</strong></span>
          <span>Duration: <strong>{formatDuration(run.duration_ms)}</strong></span>
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

      <RunTabs activeView={view} />

      <div className="run-layout">
        <div className="run-layout__main">
          {view === "flow" ? (
            <RunFlowClient runId={runId} calls={calls} />
          ) : (
            <RunHierarchy runId={runId} calls={calls} activeCallId={activeCallId} />
          )}
        </div>

        {activeCallId && (
          <ResizablePanel
            closeHref={`/runs/${runId}${view === "flow" ? "?view=flow" : ""}`}
            title={
              <PanelTitle
                label={
                  calls.find((c) => c.id === activeCallId)
                    ? callLabel(calls.find((c) => c.id === activeCallId)!)
                    : "Call"
                }
                stage={
                  calls.find((c) => c.id === activeCallId)?.stage ?? "unknown"
                }
              />
            }
          >
            <CallPanelContent runId={runId} callId={activeCallId} />
          </ResizablePanel>
        )}
      </div>
    </div>
  );
}
