"use client";

import { useState } from "react";

import type { ObsCallRow } from "@/lib/obs-db";
import { formatCost, formatTokens } from "@/lib/obs-format";
import { stageColor } from "@/lib/obs-styles";

import { buildTree, CallTree } from "./call-tree";

export type StageGroup = {
  stage: string;
  calls: ObsCallRow[];
  totalTokens: number;
  totalCost: number;
  hasError: boolean;
};

export function StageSection({
  runId,
  group,
  defaultOpen,
}: {
  runId: string;
  group: StageGroup;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const color = stageColor(group.stage);
  const tree = open ? buildTree(group.calls) : [];

  return (
    <section
      className="card"
      style={{
        borderLeft: `3px solid ${color}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          color: "inherit",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 10,
            transition: "transform 120ms ease",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            opacity: 0.7,
            fontSize: 11,
          }}
        >
          ▶
        </span>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{group.stage}</span>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 999,
            background: "var(--color-muted)",
            opacity: 0.85,
          }}
        >
          {group.calls.length} call{group.calls.length === 1 ? "" : "s"}
        </span>
        {group.hasError && (
          <span
            style={{
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 999,
              background: "rgba(239,68,68,0.15)",
              color: "#fca5a5",
              textTransform: "uppercase",
              letterSpacing: 0.4,
              fontWeight: 600,
            }}
          >
            error
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
          {formatTokens(group.totalTokens)} tok · {formatCost(group.totalCost, 4)}
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px 12px" }}>
          <CallTree runId={runId} nodes={tree} />
        </div>
      )}
    </section>
  );
}
