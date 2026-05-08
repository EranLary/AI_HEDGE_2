"use client";

import "@xyflow/react/dist/style.css";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  Edge,
  Node,
  ReactFlow,
} from "@xyflow/react";

import type { ObsCallRow } from "@/lib/obs-db";
import { stageColor, STAGE_ORDER } from "@/lib/obs-styles";

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

export default function RunFlowClient({
  runId,
  calls,
}: {
  runId: string;
  calls: ObsCallRow[];
}) {
  const router = useRouter();
  const groups = useMemo(() => groupByStage(calls), [calls]);
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>
        Click a stage to expand its calls. Click a call to open its detail page.
      </div>
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          overflow: "hidden",
          height: "calc(100vh - 320px)",
          minHeight: 480,
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
            } else if (node.id.startsWith("call:")) {
              const callId = node.id.replace(/^call:/, "");
              router.push(`/runs/${runId}/calls/${callId}?view=flow`);
            }
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
