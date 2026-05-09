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

export function callLabel(call: ObsCallRow): string {
  return call.call_site ?? call.persona ?? `#${call.sequence}`;
}

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
  const className = depth === 0 ? "tree-roots" : "tree-children";
  return (
    <ul className={className}>
      {nodes.map((node) => (
        <li key={node.call.id}>
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
  const label = callLabel(call);
  const showPersona = call.persona && call.persona !== label;
  const preview = (call.prompt ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROMPT_PREVIEW_CHARS);

  return (
    <Link href={`/runs/${runId}/calls/${call.id}`} className="row-link">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span aria-hidden className="stage-dot" style={{ background: color }} />
        <span style={{ fontWeight: 600, fontSize: 13, fontFamily: "var(--font-mono)" }}>
          {label}
        </span>
        {showPersona && (
          <span
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 999,
              background: "var(--color-muted)",
              opacity: 0.85,
            }}
          >
            {call.persona}
          </span>
        )}
        <span style={{ fontSize: 11, opacity: 0.5 }}>
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
            opacity: 0.55,
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: "var(--font-mono)",
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
