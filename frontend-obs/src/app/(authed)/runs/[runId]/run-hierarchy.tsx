"use client";

import { useMemo } from "react";

import type { ObsCallRow } from "@/lib/obs-db";
import { STAGE_ORDER } from "@/lib/obs-styles";

import { StageSection, type StageGroup } from "./stage-section";

function groupByStage(calls: ObsCallRow[]): StageGroup[] {
  const map = new Map<string, StageGroup>();
  for (const c of calls) {
    const key = c.stage || "unknown";
    let g = map.get(key);
    if (!g) {
      g = { stage: key, calls: [], totalTokens: 0, totalCost: 0, hasError: false };
      map.set(key, g);
    }
    g.calls.push(c);
    g.totalTokens += Number(c.tokens_total ?? 0);
    g.totalCost += Number(c.cost_usd ?? 0);
    if (c.status === "error") g.hasError = true;
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

export function RunHierarchy({ runId, calls }: { runId: string; calls: ObsCallRow[] }) {
  const groups = useMemo(() => groupByStage(calls), [calls]);

  if (groups.length === 0) {
    return (
      <div
        className="card"
        style={{ padding: 24, opacity: 0.7, fontSize: 14, textAlign: "center" }}
      >
        No calls recorded for this run yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.map((g) => (
        <StageSection
          key={g.stage}
          runId={runId}
          group={g}
          defaultOpen={g.hasError || groups.length === 1}
        />
      ))}
    </div>
  );
}
