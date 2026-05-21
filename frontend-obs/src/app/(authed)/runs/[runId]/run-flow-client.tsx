"use client";

import "@xyflow/react/dist/style.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
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

import {
  FitViewIcon,
  LayoutHorizontalIcon,
  LayoutVerticalIcon,
} from "@/components/icons";
import type { ObsCallSummaryRow } from "@/lib/obs-db";
import { formatCost, formatLatency } from "@/lib/obs-format";
import { stageColor } from "@/lib/obs-styles";

import { callTitle, stageDisplayName } from "@/lib/obs-labels";

const NODE_W = 220;
const NODE_H = 64;
const ROOT_W = 120;
const ROOT_H = 30;
const LANE_PAD = 10;

type Direction = "TB" | "LR";

type StageLane = {
  stage: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LaidOut = { nodes: Node[]; edges: Edge[]; lanes: StageLane[] };

function buildGraph(calls: ObsCallSummaryRow[], dir: Direction): LaidOut {
  const ids = new Set(calls.map((c) => c.id));
  const hasRoots = calls.some((c) => !c.parent_id || !ids.has(c.parent_id));
  const multipleRoots =
    calls.filter((c) => !c.parent_id || !ids.has(c.parent_id)).length > 1;
  const useSyntheticRoot = hasRoots && multipleRoots;
  const isLR = dir === "LR";

  // Stage order: first observed by sequence (deterministic, no canonical list needed).
  const stageOrder: string[] = [];
  const stageSeen = new Set<string>();
  for (const c of [...calls].sort((a, b) => a.sequence - b.sequence)) {
    if (!stageSeen.has(c.stage)) {
      stageSeen.add(c.stage);
      stageOrder.push(c.stage);
    }
  }

  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({
    rankdir: dir,
    ranksep: isLR ? 90 : 70,
    nodesep: isLR ? 24 : 28,
    edgesep: 16,
    ranker: "network-simplex",
    align: "UL",
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  if (useSyntheticRoot) {
    g.setNode("__root__", { width: ROOT_W, height: ROOT_H });
  }

  // Invisible rail nodes per stage + chained edges to fix lane order.
  for (const s of stageOrder) {
    g.setNode(`__lane_${s}__`, { width: 1, height: 1 });
  }
  for (let i = 0; i < stageOrder.length - 1; i++) {
    g.setEdge(`__lane_${stageOrder[i]}__`, `__lane_${stageOrder[i + 1]}__`, {
      weight: 0,
      minlen: 1,
    });
  }

  for (const c of calls) {
    g.setNode(c.id, { width: NODE_W, height: NODE_H });
    if (c.parent_id && ids.has(c.parent_id)) {
      g.setEdge(c.parent_id, c.id, { weight: 2, minlen: 1 });
    } else if (useSyntheticRoot) {
      g.setEdge("__root__", c.id, { weight: 1, minlen: 1 });
    }
    // Pin call to its stage's rail (zero-weight, doesn't pull layout).
    g.setEdge(`__lane_${c.stage}__`, c.id, { weight: 0, minlen: 0 });
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
        borderRadius: 8,
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

  // Compute per-stage bounding boxes from laid-out call positions.
  const stageBounds = new Map<
    string,
    { minX: number; maxX: number; minY: number; maxY: number }
  >();

  for (const c of calls) {
    const n = g.node(c.id);
    if (!n) continue;
    const color = stageColor(c.stage);
    const label = callTitle(c);
    const errored = c.status === "error";
    const stageTag = stageDisplayName(c.stage);

    const x0 = n.x - NODE_W / 2;
    const y0 = n.y - NODE_H / 2;
    const x1 = x0 + NODE_W;
    const y1 = y0 + NODE_H;
    const cur = stageBounds.get(c.stage);
    if (!cur) {
      stageBounds.set(c.stage, { minX: x0, maxX: x1, minY: y0, maxY: y1 });
    } else {
      cur.minX = Math.min(cur.minX, x0);
      cur.maxX = Math.max(cur.maxX, x1);
      cur.minY = Math.min(cur.minY, y0);
      cur.maxY = Math.max(cur.maxY, y1);
    }

    nodes.push({
      id: c.id,
      type: "default",
      position: { x: x0, y: y0 },
      data: {
        label: (
          <div
            style={{
              textAlign: "left",
              padding: "8px 10px 8px 12px",
              lineHeight: 1.25,
              position: "relative",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 3,
            }}
          >
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                paddingRight: errored ? 28 : 0,
              }}
            >
              {stageTag}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-foreground)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                paddingRight: errored ? 28 : 0,
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 10.5,
                opacity: 0.6,
                fontVariantNumeric: "tabular-nums",
                fontWeight: 500,
              }}
            >
              {formatLatency(c.latency_ms)} · {formatCost(c.cost_usd, 4)}
            </div>
            {errored && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 7,
                  fontSize: 9,
                  background: "rgba(239,68,68,0.2)",
                  color: "#fca5a5",
                  padding: "1px 5px",
                  borderRadius: 3,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  fontWeight: 700,
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
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: 0,
        color: "var(--color-foreground)",
      },
      draggable: false,
    });
  }

  for (const e of g.edges()) {
    if (e.v.startsWith("__lane_") || e.w.startsWith("__lane_")) continue;
    const isRootEdge = e.v === "__root__";
    edges.push({
      id: `${e.v}->${e.w}`,
      source: e.v,
      target: e.w,
      type: "smoothstep",
      data: { borderRadius: 12 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: {
        stroke: "var(--color-border)",
        strokeWidth: 1.2,
        ...(isRootEdge ? { strokeDasharray: "3 3" } : null),
      },
    });
  }

  // Lane backgrounds: one rect per stage spanning the full canvas in the
  // perpendicular axis but tightly hugging the stage's nodes along rankdir.
  const lanes: StageLane[] = [];
  if (stageBounds.size > 0) {
    let canvasMinX = Infinity;
    let canvasMaxX = -Infinity;
    let canvasMinY = Infinity;
    let canvasMaxY = -Infinity;
    for (const b of stageBounds.values()) {
      canvasMinX = Math.min(canvasMinX, b.minX);
      canvasMaxX = Math.max(canvasMaxX, b.maxX);
      canvasMinY = Math.min(canvasMinY, b.minY);
      canvasMaxY = Math.max(canvasMaxY, b.maxY);
    }
    for (const [stage, b] of stageBounds.entries()) {
      if (isLR) {
        lanes.push({
          stage,
          x: b.minX - LANE_PAD,
          y: canvasMinY - LANE_PAD,
          width: b.maxX - b.minX + LANE_PAD * 2,
          height: canvasMaxY - canvasMinY + LANE_PAD * 2,
        });
      } else {
        lanes.push({
          stage,
          x: canvasMinX - LANE_PAD,
          y: b.minY - LANE_PAD,
          width: canvasMaxX - canvasMinX + LANE_PAD * 2,
          height: b.maxY - b.minY + LANE_PAD * 2,
        });
      }
    }
  }

  return { nodes, edges, lanes };
}

const DIR_STORAGE_KEY = "obs.flow.dir";

function readSavedDir(): Direction {
  if (typeof window === "undefined") return "TB";
  const raw = window.localStorage.getItem(DIR_STORAGE_KEY);
  return raw === "LR" ? "LR" : "TB";
}

function FlowInner({ runId, calls }: { runId: string; calls: ObsCallSummaryRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dir, setDir] = useState<Direction>("TB");
  useEffect(() => {
    setDir(readSavedDir());
  }, []);
  const { nodes: callNodes, edges, lanes } = useMemo(
    () => buildGraph(calls, dir),
    [calls, dir],
  );

  // Prepend invisible lane background "nodes" so they render under the calls.
  const nodes: Node[] = useMemo(() => {
    const laneNodes: Node[] = lanes.map((l) => ({
      id: `__bg_${l.stage}__`,
      position: { x: l.x, y: l.y },
      data: { label: null },
      type: "default",
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 0,
      style: {
        width: l.width,
        height: l.height,
        background: stageColor(l.stage),
        opacity: 0.06,
        border: `1px dashed ${stageColor(l.stage)}`,
        borderRadius: 12,
        pointerEvents: "none",
        boxShadow: "none",
        padding: 0,
      },
    }));
    const withZ = callNodes.map((n) => ({ ...n, zIndex: 10 }));
    return [...laneNodes, ...withZ];
  }, [lanes, callNodes]);

  const { fitView } = useReactFlow();

  // Re-fit after direction change so the new layout is centered.
  useEffect(() => {
    const id = window.setTimeout(() => fitView({ padding: 0.2, duration: 250 }), 50);
    return () => window.clearTimeout(id);
  }, [dir, fitView]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.id === "__root__" || node.id.startsWith("__bg_")) return;
      startTransition(() => {
        router.push(`/runs/${runId}?call=${node.id}&view=flow`, { scroll: false });
      });
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

  const nextDirIsLR = dir === "TB";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          Hierarchy by parent_id ({dir === "TB" ? "top-down" : "left-to-right"}). Click a call to open its detail panel.
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="btn-ghost btn-ghost--icon"
            onClick={toggleDir}
            title={nextDirIsLR ? "Horizontal layout" : "Vertical layout"}
            aria-label={`Switch to ${nextDirIsLR ? "horizontal" : "vertical"} layout`}
          >
            {nextDirIsLR ? <LayoutHorizontalIcon /> : <LayoutVerticalIcon />}
          </button>
          <button
            type="button"
            className="btn-ghost btn-ghost--icon"
            onClick={() => fitView({ padding: 0.2, duration: 200 })}
            title="Fit view"
            aria-label="Fit view"
          >
            <FitViewIcon />
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
          opacity: isPending ? 0.85 : 1,
          transition: "opacity 120ms ease",
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
                : n.id.startsWith("__bg_")
                  ? "transparent"
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
  calls: ObsCallSummaryRow[];
}) {
  return (
    <ReactFlowProvider>
      <FlowInner runId={runId} calls={calls} />
    </ReactFlowProvider>
  );
}
