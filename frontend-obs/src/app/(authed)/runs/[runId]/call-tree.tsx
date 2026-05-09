"use client";

import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import type { ObsCallRow } from "@/lib/obs-db";
import { formatCost, formatLatency, formatTokens } from "@/lib/obs-format";
import { callLabel, callTitle } from "@/lib/obs-labels";
import { stageColor } from "@/lib/obs-styles";

export type TreeNode = {
  call: ObsCallRow;
  children: TreeNode[];
};

export { callLabel, callTitle };

export function CallTree({
  runId,
  nodes,
  activeCallId,
  depth = 0,
}: {
  runId: string;
  nodes: TreeNode[];
  activeCallId?: string | null;
  depth?: number;
}) {
  if (nodes.length === 0) return null;
  const className = depth === 0 ? "tree-roots" : "tree-children";
  return (
    <ul className={className}>
      {nodes.map((node) => (
        <li key={node.call.id}>
          <CallRow runId={runId} call={node.call} active={node.call.id === activeCallId} />
          {node.children.length > 0 && (
            <CallTree
              runId={runId}
              nodes={node.children}
              activeCallId={activeCallId}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function CallRow({
  runId,
  call,
  active,
}: {
  runId: string;
  call: ObsCallRow;
  active: boolean;
}) {
  const color = stageColor(call.stage);
  const title = callTitle(call);
  const technical = callLabel(call);
  const showSubtitle = technical && technical !== title;

  return (
    <Link
      href={`/runs/${runId}?call=${call.id}`}
      className={active ? "row-link is-active" : "row-link"}
      scroll={false}
      prefetch={false}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span aria-hidden className="stage-dot" style={{ background: color }} />
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>
          {call.model_actual ?? call.model_requested}
        </span>
        <StatusPill status={call.status} />
        <span style={{ flex: 1 }} />
        <span
          className="call-row__metrics"
          style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}
        >
          {formatTokens(call.tokens_in)}↑ {formatTokens(call.tokens_out)}↓ ·{" "}
          {formatLatency(call.latency_ms)} · {formatCost(call.cost_usd, 4)}
        </span>
      </div>
      {showSubtitle && (
        <div
          className="call-row__preview"
          style={{
            fontSize: 11,
            opacity: 0.5,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: "var(--font-mono)",
          }}
        >
          {technical}
          {call.persona && call.persona !== technical ? ` · ${call.persona}` : ""}
        </div>
      )}
    </Link>
  );
}

export function buildTree(calls: ObsCallRow[]): TreeNode[] {
  const ids = new Set(calls.map((c) => c.id));
  const map = new Map<string, TreeNode>();
  for (const c of calls) map.set(c.id, { call: c, children: [] });
  const roots: TreeNode[] = [];
  for (const c of calls) {
    const node = map.get(c.id)!;
    if (c.parent_id && ids.has(c.parent_id)) {
      map.get(c.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortBySeq = (a: TreeNode, b: TreeNode) => a.call.sequence - b.call.sequence;
  roots.sort(sortBySeq);
  for (const n of map.values()) n.children.sort(sortBySeq);
  return roots;
}
