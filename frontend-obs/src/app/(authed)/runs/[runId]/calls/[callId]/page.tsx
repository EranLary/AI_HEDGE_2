import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { CopyButton } from "@/components/copy-button";
import { StatusPill } from "@/components/status-pill";
import {
  getCall,
  getRun,
  listChildCalls,
  type ObsCallRow,
} from "@/lib/obs-db";
import {
  formatCost,
  formatLatency,
  formatTokens,
} from "@/lib/obs-format";
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
        <span
          style={{
            fontSize: 12,
            padding: "3px 10px",
            borderRadius: 999,
            border: `1px solid ${color}`,
            color,
            background: "transparent",
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
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>
          Call #{call.sequence}
        </h1>
        <div style={{ opacity: 0.7, fontSize: 13 }}>
          {call.model_actual ?? call.model_requested} · temp {call.temperature}
          {call.call_site ? ` · ${call.call_site}` : ""}
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

      <Section title="Prompt" copyText={call.prompt}>
        <pre style={preStyle}>{call.prompt}</pre>
      </Section>
      <Section
        title="Response"
        copyText={call.response ?? ""}
      >
        <pre style={preStyle}>{call.response ?? "(no response captured)"}</pre>
      </Section>
      {call.reasoning && (
        <Section title="Reasoning" copyText={call.reasoning}>
          <pre style={preStyle}>{call.reasoning}</pre>
        </Section>
      )}
      {call.error_message && (
        <Section title={`Error · ${call.error_class ?? ""}`} copyText={call.error_message}>
          <pre style={{ ...preStyle, color: "#fca5a5" }}>{call.error_message}</pre>
        </Section>
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

function Section({
  title,
  copyText,
  children,
}: {
  title: string;
  copyText?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 11,
            opacity: 0.7,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {title}
        </div>
        {copyText ? <CopyButton text={copyText} /> : null}
      </div>
      {children}
    </div>
  );
}

const preStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  margin: 0,
  padding: 14,
  background: "var(--color-card-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  lineHeight: 1.55,
};

function CallContext({
  runId,
  parent,
  children,
  backView,
}: {
  runId: string;
  parent: ObsCallRow | null;
  children: ObsCallRow[];
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

function CallSummary({ call }: { call: ObsCallRow }) {
  const color = stageColor(call.stage);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: color,
          display: "inline-block",
        }}
      />
      <span style={{ fontWeight: 600 }}>
        {call.persona ?? `#${call.sequence}`}
      </span>
      <span style={{ opacity: 0.6 }}>{call.stage}</span>
      <span style={{ opacity: 0.5 }}>· {formatLatency(call.latency_ms)}</span>
      <span style={{ opacity: 0.5 }}>· {formatCost(call.cost_usd, 4)}</span>
    </div>
  );
}
