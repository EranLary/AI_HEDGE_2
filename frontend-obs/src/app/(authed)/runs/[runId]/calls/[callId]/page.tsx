import Link from "next/link";
import { notFound } from "next/navigation";

import { CollapsibleMarkdown } from "@/components/collapsible-markdown";
import { StatusPill } from "@/components/status-pill";
import {
  getCall,
  getRun,
  listChildCalls,
  type ObsCallSummaryRow,
} from "@/lib/obs-db";
import {
  formatCost,
  formatLatency,
  formatTokens,
} from "@/lib/obs-format";
import { callLabel, callTitle } from "@/lib/obs-labels";
import { stageColor } from "@/lib/obs-styles";

export const dynamic = "force-dynamic";

type Params = { runId: string; callId: string };

export default async function CallDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const { runId, callId } = await params;
  const sp = (await searchParams) ?? {};
  const backView = sp.view === "flow" ? "flow" : "hierarchy";

  const [run, call] = await Promise.all([getRun(runId), getCall(callId)]);
  if (!run || !call || call.run_id !== run.id) notFound();

  const [parent, children] = await Promise.all([
    call.parent_id ? getCall(call.parent_id) : Promise.resolve(null),
    listChildCalls(call.id),
  ]);

  const color = stageColor(call.stage);
  const backHref = `/runs/${runId}${backView === "flow" ? "?view=flow" : ""}`;
  const title = callTitle(call);
  const technical = callLabel(call);
  const showSubtitle = technical && technical !== title;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Link href={backHref} className="btn-ghost">
          ← Back to {run.ticker} run
        </Link>
        <span style={{ opacity: 0.4 }}>/</span>
        <span aria-hidden className="stage-dot" style={{ background: color }} />
        <span
          style={{
            fontSize: 12,
            opacity: 0.85,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            fontWeight: 600,
          }}
        >
          {call.stage}
        </span>
        {call.persona && (
          <span style={{ opacity: 0.7, fontSize: 13 }}>· {call.persona}</span>
        )}
        <StatusPill status={call.status} />
      </div>

      <div>
        <h1
          style={{
            fontSize: 22,
            marginBottom: 4,
            fontWeight: 600,
            letterSpacing: "-0.2px",
            wordBreak: "break-word",
          }}
        >
          {title}
        </h1>
        <div
          style={{
            opacity: 0.65,
            fontSize: 12.5,
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
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 8,
        }}
      >
        <Stat label="Tokens in" value={formatTokens(call.tokens_in)} />
        <Stat label="Tokens out" value={formatTokens(call.tokens_out)} />
        <Stat label="Tokens total" value={formatTokens(call.tokens_total)} />
        <Stat label="Cost" value={formatCost(call.cost_usd, 6)} />
        <Stat label="Latency" value={formatLatency(call.latency_ms)} />
        <Stat label="Retries" value={String(call.retries)} />
        <Stat label="Started" value={new Date(call.started_at).toLocaleString()} />
        <Stat label="Ended" value={new Date(call.ended_at).toLocaleString()} />
      </div>

      <CallContext runId={runId} parent={parent} children={children} backView={backView} />

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
    <div className="card" style={{ padding: "8px 12px" }}>
      <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function CallContext({
  runId,
  parent,
  children,
  backView,
}: {
  runId: string;
  parent: ObsCallSummaryRow | null;
  children: ObsCallSummaryRow[];
  backView: "flow" | "hierarchy";
}) {
  if (!parent && children.length === 0) return null;
  const suffix = backView === "flow" ? "?view=flow" : "";
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 11, opacity: 0.65, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
        Hierarchy
      </div>
      {parent && (
        <div style={{ marginBottom: children.length ? 12 : 0 }}>
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Parent call</div>
          <Link href={`/runs/${runId}/calls/${parent.id}${suffix}`} className="row-link">
            <CallSummary call={parent} />
          </Link>
        </div>
      )}
      {children.length > 0 && (
        <div>
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
            Sub-calls ({children.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {children.map((c) => (
              <Link key={c.id} href={`/runs/${runId}/calls/${c.id}${suffix}`} className="row-link">
                <CallSummary call={c} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CallSummary({ call }: { call: ObsCallSummaryRow }) {
  const color = stageColor(call.stage);
  const title = callTitle(call);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
      <span aria-hidden className="stage-dot" style={{ background: color }} />
      <span style={{ fontWeight: 600 }}>{title}</span>
      <span style={{ opacity: 0.6 }}>{call.stage}</span>
      <span style={{ opacity: 0.5 }}>· {formatLatency(call.latency_ms)}</span>
      <span style={{ opacity: 0.5 }}>· {formatCost(call.cost_usd, 4)}</span>
    </div>
  );
}
