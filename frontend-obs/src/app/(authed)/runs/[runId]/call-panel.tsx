import Link from "next/link";

import { CollapsibleMarkdown } from "@/components/collapsible-markdown";
import { StatusPill } from "@/components/status-pill";
import {
  getCall,
  listChildCalls,
  type ObsCallRow,
} from "@/lib/obs-db";
import {
  formatCost,
  formatLatency,
  formatTokens,
} from "@/lib/obs-format";
import { callLabel, callTitle, stageDisplayName } from "@/lib/obs-labels";
import { stageColor } from "@/lib/obs-styles";

export async function CallPanelContent({
  runId,
  callId,
}: {
  runId: string;
  callId: string;
}) {
  const call = await getCall(callId);
  if (!call || call.run_id !== runId) {
    return (
      <div style={{ opacity: 0.7, fontSize: 13 }}>
        Call not found in this run.
      </div>
    );
  }

  const [parent, children] = await Promise.all([
    call.parent_id ? getCall(call.parent_id) : Promise.resolve(null),
    listChildCalls(call.id),
  ]);

  const stageLabel = stageDisplayName(call.stage);
  const technical = callLabel(call);
  const subtitleParts: string[] = [stageLabel];
  if (call.persona && call.persona !== technical) subtitleParts.push(call.persona);
  if (technical && technical !== stageLabel)
    subtitleParts.push(technical);
  else subtitleParts.push(`#${call.sequence}`);
  subtitleParts.push(call.model_actual ?? call.model_requested);
  subtitleParts.push(`temp ${call.temperature}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <StatusPill status={call.status} />
        <span
          style={{
            fontSize: 11.5,
            opacity: 0.7,
            fontFamily: "var(--font-mono)",
            wordBreak: "break-word",
          }}
        >
          {subtitleParts.join(" · ")}
        </span>
        <span style={{ flex: 1 }} />
        <Link
          href={`/runs/${runId}/calls/${call.id}`}
          className="btn-ghost btn-ghost--icon"
          style={{ padding: "4px 6px" }}
          title="Open full page"
          aria-label="Open full page"
        >
          <svg
            width={13}
            height={13}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 6V3h3" />
            <path d="M13 6V3h-3" />
            <path d="M3 10v3h3" />
            <path d="M13 10v3h-3" />
          </svg>
        </Link>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 6,
        }}
      >
        <Stat label="Cost" value={formatCost(call.cost_usd, 6)} />
        <Stat label="Latency" value={formatLatency(call.latency_ms)} />
        <Stat label="Retries" value={String(call.retries)} />
      </div>

      <PanelHierarchy runId={runId} parent={parent} children={children} />

      <CollapsibleMarkdown
        title="Prompt"
        body={call.prompt}
        defaultOpen={false}
        meta={`${formatTokens(call.tokens_in)} tok in`}
      />
      <CollapsibleMarkdown
        title="Response"
        body={call.response}
        defaultOpen
        meta={`${formatTokens(call.tokens_out)} tok out · ${formatLatency(call.latency_ms)}`}
      />
      {call.reasoning && (
        <CollapsibleMarkdown
          title="Reasoning"
          body={call.reasoning}
          defaultOpen={false}
        />
      )}
      {call.error_message && (
        <CollapsibleMarkdown
          title={`Error · ${call.error_class ?? ""}`}
          body={call.error_message}
          defaultOpen
          emphasizeError
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "6px 10px" }}>
      <div style={{ fontSize: 9.5, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function PanelHierarchy({
  runId,
  parent,
  children,
}: {
  runId: string;
  parent: ObsCallRow | null;
  children: ObsCallRow[];
}) {
  if (!parent && children.length === 0) return null;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div style={{ fontSize: 10.5, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
        Hierarchy
      </div>
      {parent && (
        <div style={{ marginBottom: children.length ? 8 : 0 }}>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginBottom: 3 }}>Parent</div>
          <Link
            href={`/runs/${runId}?call=${parent.id}`}
            replace
            scroll={false}
            className="row-link"
            style={{ padding: "6px 8px" }}
          >
            <PanelCallSummary call={parent} />
          </Link>
        </div>
      )}
      {children.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, opacity: 0.55, marginBottom: 3 }}>
            Sub-calls ({children.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {children.map((c) => (
              <Link
                key={c.id}
                href={`/runs/${runId}?call=${c.id}`}
                replace
                scroll={false}
                className="row-link"
                style={{ padding: "6px 8px" }}
              >
                <PanelCallSummary call={c} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelCallSummary({ call }: { call: ObsCallRow }) {
  const color = stageColor(call.stage);
  const title = callTitle(call);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, minWidth: 0 }}>
      <span aria-hidden className="stage-dot" style={{ background: color }} />
      <span
        style={{
          fontWeight: 600,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      <span style={{ opacity: 0.55, fontSize: 11 }}>· {formatLatency(call.latency_ms)}</span>
      <span style={{ opacity: 0.55, fontSize: 11 }}>· {formatCost(call.cost_usd, 4)}</span>
    </div>
  );
}

export function PanelTitle({ label, stage }: { label: string; stage: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span aria-hidden className="stage-dot" style={{ background: stageColor(stage) }} />
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </div>
  );
}
