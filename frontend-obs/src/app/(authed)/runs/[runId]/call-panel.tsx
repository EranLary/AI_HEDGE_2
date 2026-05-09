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
import { callLabel, callTitle } from "@/lib/obs-labels";
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

  const color = stageColor(call.stage);
  const title = callTitle(call);
  const technical = callLabel(call);
  const showSubtitle = technical && technical !== title;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span aria-hidden className="stage-dot" style={{ background: color }} />
        <span
          style={{
            fontSize: 11,
            opacity: 0.85,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            fontWeight: 600,
          }}
        >
          {call.stage}
        </span>
        {call.persona && (
          <span style={{ opacity: 0.7, fontSize: 12 }}>· {call.persona}</span>
        )}
        <StatusPill status={call.status} />
        <span style={{ flex: 1 }} />
        <Link
          href={`/runs/${runId}/calls/${call.id}`}
          className="btn-ghost"
          style={{ fontSize: 11, padding: "3px 8px" }}
        >
          Open full page
        </Link>
      </div>

      <div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            wordBreak: "break-word",
            lineHeight: 1.3,
          }}
        >
          {title}
        </div>
        <div
          style={{
            opacity: 0.6,
            fontSize: 11.5,
            marginTop: 3,
            fontFamily: showSubtitle ? "var(--font-mono)" : undefined,
          }}
        >
          {showSubtitle ? `${technical} · ` : ""}#{call.sequence} ·{" "}
          {call.model_actual ?? call.model_requested} · temp {call.temperature}
        </div>
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
