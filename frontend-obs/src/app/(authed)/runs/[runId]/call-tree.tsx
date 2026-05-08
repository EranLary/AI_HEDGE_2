"use client";

import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import type { ObsCallRow } from "@/lib/obs-db";
import { formatCost, formatLatency, formatTokens } from "@/lib/obs-format";
import { stageColor } from "@/lib/obs-styles";

export type TreeNode = {
  call: ObsCallRow;
  children: TreeNode[];
};

const PROMPT_PREVIEW_CHARS = 140;

export function CallTree({
  runId,
  nodes,
  depth = 0,
}: {
  runId: string;
  nodes: TreeNode[];
  depth?: number;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        marginLeft: depth === 0 ? 0 : 14,
        borderLeft: depth === 0 ? "none" : "1px dashed var(--color-border)",
      }}
    >
      {nodes.map((node) => (
        <li key={node.call.id} style={{ paddingLeft: depth === 0 ? 0 : 12, marginTop: 4 }}>
          <CallRow runId={runId} call={node.call} />
          {node.children.length > 0 && (
            <CallTree runId={runId} nodes={node.children} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

function CallRow({ runId, call }: { runId: string; call: ObsCallRow }) {
  const color = stageColor(call.stage);
  const preview = (call.prompt ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROMPT_PREVIEW_CHARS);

  return (
    <Link
      href={`/runs/${runId}/calls/${call.id}`}
      className="row-link"
      style={{ borderLeft: `2px solid ${color}`, paddingLeft: 10, display: "block" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {call.persona ?? `#${call.sequence}`}
        </span>
        <span style={{ fontSize: 11, opacity: 0.55 }}>
          {call.model_actual ?? call.model_requested}
        </span>
        <StatusPill status={call.status} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
          {formatTokens(call.tokens_in)}↑ {formatTokens(call.tokens_out)}↓ ·{" "}
          {formatLatency(call.latency_ms)} · {formatCost(call.cost_usd, 4)}
        </span>
      </div>
      {preview && (
        <div
          style={{
            fontSize: 12,
            opacity: 0.6,
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {preview}
          {call.prompt && call.prompt.length > PROMPT_PREVIEW_CHARS ? "…" : ""}
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
