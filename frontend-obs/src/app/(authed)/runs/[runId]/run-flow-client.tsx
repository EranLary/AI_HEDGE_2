"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dagre from "dagre";
import {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";

import type { ObsCallRow } from "@/lib/obs-db";
import { formatCost, formatLatency } from "@/lib/obs-format";
import { stageColor } from "@/lib/obs-styles";

import { callTitle } from "@/lib/obs-labels";

const NODE_W = 200;
const NODE_H = 50;
const ROOT_W = 110;
const ROOT_H = 28;

type Direction = "TB" | "LR";

type LaidOut = { nodes: Node[]; edges: Edge[] };

function buildGraph(calls: ObsCallRow[], dir: Direction): LaidOut {
  const ids = new Set(calls.map((c) => c.id));
  const hasRoots = calls.some((c) => !c.parent_id || !ids.has(c.parent_id));
  const multipleRoots =
    calls.filter((c) => !c.parent_id || !ids.has(c.parent_id)).length > 1;
  const useSyntheticRoot = hasRoots && multipleRoots;
  const isLR = dir === "LR";

  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({
    rankdir: dir,
    // Tighter spacing for compact layouts; LR needs slightly more
    // between ranks because nodes are wider than tall.
    ranksep: isLR ? 60 : 44,
    nodesep: isLR ? 14 : 18,
    marginx: 16,
    marginy: 16,
  });
  g.setDefaultEdgeLabel(() => ({}));

  if (useSyntheticRoot) {
    g.setNode("__root__", { width: ROOT_W, height: ROOT_H });
  }

  for (const c of calls) {
    g.setNode(c.id, { width: NODE_W, height: NODE_H });
    if (c.parent_id && ids.has(c.parent_id)) {
      g.setEdge(c.parent_id, c.id);
    } else if (useSyntheticRoot) {
      g.setEdge("__root__", c.id);
    }
  }

  dagre.layout(g);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const sourcePosition = isLR ? Position.Right : Position.Bottom;
  const targetPosition = isLR ? Position.Left : Position.Top;

  if (useSyntheticRoot) {
    const n = g.node("__root__");
    nodes.push({
      id: "__root__",
      type: "default",
      position: { x: n.x - ROOT_W / 2, y: n.y - ROOT_H / 2 },
      data: {
        label: (
          <div style={{ fontSize: 10.5, fontWeight: 600, opacity: 0.85, textAlign: "center", lineHeight: 1 }}>
            run start
          </div>
        ),
      },
      sourcePosition,
      targetPosition,
      style: {
        width: ROOT_W,
        height: ROOT_H,
        background: "var(--color-muted)",
        border: "1px dashed var(--color-border)",
        borderRadius: 6,
        color: "var(--color-foreground)",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
      draggable: false,
      selectable: false,
    });
  }

  for (const c of calls) {
    const n = g.node(c.id);
    if (!n) continue;
    const color = stageColor(c.stage);
    const label = callTitle(c);
    const errored = c.status === "error";

    nodes.push({
      id: c.id,
      type: "default",
      position: { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 },
      data: {
        label: (
          <div
            style={{
              textAlign: "left",
              padding: "5px 8px 5px 9px",
              lineHeight: 1.2,
              position: "relative",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-foreground)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                paddingRight: errored ? 24 : 0,
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 10,
                opacity: 0.6,
                fontVariantNumeric: "tabular-nums",
                marginTop: 1,
              }}
            >
              {formatLatency(c.latency_ms)} · {formatCost(c.cost_usd, 4)}
            </div>
            {errored && (
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  right: 5,
                  fontSize: 8.5,
                  background: "rgba(239,68,68,0.18)",
                  color: "#fca5a5",
                  padding: "1px 4px",
                  borderRadius: 3,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  fontWeight: 600,
                }}
              >
                err
              </span>
            )}
          </div>
        ),
      },
      sourcePosition,
      targetPosition,
      style: {
        width: NODE_W,
        height: NODE_H,
        background: "var(--color-card-bg)",
        borderTop: "1px solid var(--color-border)",
        borderRight: "1px solid var(--color-border)",
        borderBottom: "1px solid var(--color-border)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
        padding: 0,
        color: "var(--color-foreground)",
      },
      draggable: false,
    });
  }

  for (const e of g.edges()) {
    const isRootEdge = e.v === "__root__";
    edges.push({
      id: `${e.v}->${e.w}`,
      source: e.v,
      target: e.w,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: {
        stroke: isRootEdge ? "var(--color-border)" : "var(--color-border)",
        strokeWidth: 1.4,
      },
    });
  }

  return { nodes, edges };
}

const DIR_STORAGE_KEY = "obs.flow.dir";

function readSavedDir(): Direction {
  if (typeof window === "undefined") return "TB";
  const raw = window.localStorage.getItem(DIR_STORAGE_KEY);
  return raw === "LR" ? "LR" : "TB";
}

function FlowInner({ runId, calls }: { runId: string; calls: ObsCallRow[] }) {
  const router = useRouter();
  const [dir, setDir] = useState<Direction>("TB");
  useEffect(() => {
    setDir(readSavedDir());
  }, []);
  const { nodes, edges } = useMemo(() => buildGraph(calls, dir), [calls, dir]);
  const { fitView } = useReactFlow();

  // Re-fit after direction change so the new layout is centered.
  useEffect(() => {
    const id = window.setTimeout(() => fitView({ padding: 0.2, duration: 250 }), 50);
    return () => window.clearTimeout(id);
  }, [dir, fitView]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.id === "__root__") return;
      router.push(`/runs/${runId}?call=${node.id}&view=flow`, { scroll: false });
    },
    [router, runId],
  );

  const toggleDir = useCallback(() => {
    setDir((d) => {
      const next: Direction = d === "TB" ? "LR" : "TB";
      try {
        window.localStorage.setItem(DIR_STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          Hierarchy by parent_id ({dir === "TB" ? "top-down" : "left-to-right"}). Click a call to open its detail panel.
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn-ghost"
            onClick={toggleDir}
            style={{ fontSize: 11, padding: "4px 10px" }}
            aria-label={`Switch to ${dir === "TB" ? "horizontal" : "vertical"} layout`}
          >
            {dir === "TB" ? "Horizontal" : "Vertical"} layout
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => fitView({ padding: 0.2, duration: 200 })}
            style={{ fontSize: 11, padding: "4px 10px" }}
          >
            Fit view
          </button>
        </div>
      </div>
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          overflow: "hidden",
          height: "calc(100vh - 320px)",
          minHeight: 480,
          background: "var(--color-background)",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onNodeClick={onNodeClick}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              n.id === "__root__"
                ? "rgba(148,163,184,0.4)"
                : (n.style?.borderLeft as string)?.split(" ").pop() ?? "#94a3b8"
            }
            maskColor="rgba(11,18,32,0.5)"
            style={{ background: "var(--color-muted)" }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function RunFlowClient({
  runId,
  calls,
}: {
  runId: string;
  calls: ObsCallRow[];
}) {
  return (
    <ReactFlowProvider>
      <FlowInner runId={runId} calls={calls} />
    </ReactFlowProvider>
  );
}
