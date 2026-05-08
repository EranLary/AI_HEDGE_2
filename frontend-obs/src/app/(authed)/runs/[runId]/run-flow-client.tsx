"use client";

import "@xyflow/react/dist/style.css";

import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Edge,
  Node,
  ReactFlow,
} from "@xyflow/react";

import type { ObsCallRow } from "@/lib/obs-db";

const STAGE_ORDER = [
  "analyst",
  "sec.qa",
  "sec.short",
  "dashboard.extract",
  "valuations",
  "technical",
  "unknown",
];

type StageGroup = {
  stage: string;
  calls: ObsCallRow[];
  totalCost: number;
  totalTokens: number;
};

function groupByStage(calls: ObsCallRow[]): StageGroup[] {
  const map = new Map<string, StageGroup>();
  for (const c of calls) {
    const key = c.stage || "unknown";
    let g = map.get(key);
    if (!g) {
      g = { stage: key, calls: [], totalCost: 0, totalTokens: 0 };
      map.set(key, g);
    }
    g.calls.push(c);
    g.totalCost += Number(c.cost_usd ?? 0);
    g.totalTokens += Number(c.tokens_total ?? 0);
  }
  const ordered: StageGroup[] = [];
  for (const s of STAGE_ORDER) {
    const g = map.get(s);
    if (g) {
      ordered.push(g);
      map.delete(s);
    }
  }
  for (const g of map.values()) ordered.push(g);
  return ordered;
}

function stageColor(stage: string): string {
  if (stage.startsWith("persona")) return "#fbbf24";
  if (stage.startsWith("sec")) return "#a78bfa";
  if (stage.startsWith("valuation")) return "#34d399";
  if (stage === "analyst") return "#60a5fa";
  if (stage === "technical") return "#f87171";
  if (stage.startsWith("dashboard")) return "#22d3ee";
  return "#94a3b8";
}

export default function RunFlowClient({ calls }: { calls: ObsCallRow[] }) {
  const groups = useMemo(() => groupByStage(calls), [calls]);
  const [selected, setSelected] = useState<ObsCallRow | null>(null);
  const [openStage, setOpenStage] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const xStep = 220;
    const yStage = 60;
    const yCallStart = 180;
    const yCallStep = 60;

    groups.forEach((g, i) => {
      const x = i * xStep;
      const color = stageColor(g.stage);
      const isOpen = openStage === g.stage;
      nodes.push({
        id: `stage:${g.stage}`,
        type: "default",
        position: { x, y: yStage },
        data: {
          label: (
            <div style={{ textAlign: "center", lineHeight: 1.3, padding: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{g.stage}</div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>
                {g.calls.length} call{g.calls.length === 1 ? "" : "s"}
              </div>
              <div style={{ fontSize: 11, opacity: 0.85 }}>
                ${g.totalCost.toFixed(4)}
              </div>
            </div>
          ),
        },
        style: {
          background: color,
          color: "#0f172a",
          border: isOpen ? "3px solid #0f172a" : "1px solid rgba(15,23,42,0.4)",
          borderRadius: 8,
          width: 180,
          padding: 8,
        },
      });

      if (i > 0) {
        edges.push({
          id: `e:${i - 1}->${i}`,
          source: `stage:${groups[i - 1].stage}`,
          target: `stage:${g.stage}`,
          animated: false,
        });
      }

      if (isOpen) {
        g.calls.forEach((c, j) => {
          nodes.push({
            id: `call:${c.id}`,
            type: "default",
            position: { x: x - 10, y: yCallStart + j * yCallStep },
            data: {
              label: (
                <div style={{ fontSize: 11, lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 600 }}>
                    {c.persona ?? `#${c.sequence}`}
                  </div>
                  <div style={{ opacity: 0.7 }}>
                    {(c.tokens_in ?? 0)}↑ {(c.tokens_out ?? 0)}↓ ·{" "}
                    {c.cost_usd ? `$${Number(c.cost_usd).toFixed(4)}` : "—"}
                  </div>
                  <div style={{ opacity: 0.7 }}>
                    {(c.latency_ms / 1000).toFixed(1)}s · {c.model_actual ?? c.model_requested}
                  </div>
                </div>
              ),
            },
            style: {
              background: "var(--color-background)",
              color: "var(--color-foreground)",
              border: `1px solid ${color}`,
              borderRadius: 6,
              width: 200,
              padding: 6,
              fontSize: 11,
            },
          });
          edges.push({
            id: `ec:${c.id}`,
            source: `stage:${g.stage}`,
            target: `call:${c.id}`,
            style: { stroke: color, strokeWidth: 1, strokeDasharray: "3 3" },
          });
        });
      }
    });

    return { nodes, edges };
  }, [groups, openStage]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 16, height: "calc(100vh - 220px)" }}>
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onNodeClick={(_, node) => {
            if (node.id.startsWith("stage:")) {
              const stage = node.id.replace(/^stage:/, "");
              setOpenStage(openStage === stage ? null : stage);
              setSelected(null);
            } else if (node.id.startsWith("call:")) {
              const callId = node.id.replace(/^call:/, "");
              const c = calls.find((c) => c.id === callId) ?? null;
              setSelected(c);
            }
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <SidePanel call={selected} />
    </div>
  );
}

function SidePanel({ call }: { call: ObsCallRow | null }) {
  if (!call) {
    return (
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          padding: 16,
          fontSize: 13,
          opacity: 0.7,
          overflow: "auto",
        }}
      >
        Click a stage node to expand its calls. Click a call to see the
        full prompt, response, tokens, and cost here.
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: 16,
        fontSize: 13,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {call.stage}
          {call.persona ? ` · ${call.persona}` : ""}
        </div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Call #{call.sequence}</div>
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          {call.model_actual ?? call.model_requested} · temp {call.temperature}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
        <Stat label="Tokens in" value={call.tokens_in ?? "—"} />
        <Stat label="Tokens out" value={call.tokens_out ?? "—"} />
        <Stat label="Cost" value={call.cost_usd ? `$${Number(call.cost_usd).toFixed(6)}` : "—"} />
        <Stat label="Latency" value={`${(call.latency_ms / 1000).toFixed(2)}s`} />
        <Stat label="Retries" value={call.retries} />
        <Stat label="Status" value={call.status} />
      </div>

      <Section title="Prompt">
        <pre style={preStyle}>{call.prompt}</pre>
      </Section>
      <Section title="Response">
        <pre style={preStyle}>{call.response ?? "(no response captured)"}</pre>
      </Section>
      {call.reasoning && (
        <Section title="Reasoning">
          <pre style={preStyle}>{call.reasoning}</pre>
        </Section>
      )}
      {call.error_message && (
        <Section title="Error">
          <pre style={{ ...preStyle, color: "#fca5a5" }}>{call.error_message}</pre>
        </Section>
      )}
    </div>
  );
}

const preStyle: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  margin: 0,
  padding: 8,
  background: "rgba(0,0,0,0.04)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  maxHeight: 320,
  overflow: "auto",
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.04)",
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid var(--color-border)",
      }}
    >
      <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          opacity: 0.7,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
