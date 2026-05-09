"use client";

import { useEffect, useRef, useState } from "react";

import type { SpendBreakdownRow } from "@/lib/obs-db";
import { formatCost } from "@/lib/obs-format";
import { stageColor } from "@/lib/obs-styles";
import { squarify, type TreemapRect } from "@/lib/treemap";

type StageGroup = {
  stage: string;
  total: number;
  rows: { id: string; label: string; value: number; count: number }[];
};

type RenderedCell = TreemapRect & {
  stage: string;
  label: string;
  count: number;
  outer: TreemapRect;
};

const PADDING = 4;
const HEADER_HEIGHT = 18;

function groupByStage(rows: SpendBreakdownRow[]): StageGroup[] {
  const map = new Map<string, StageGroup>();
  for (const r of rows) {
    const v = Number(r.cost_usd) || 0;
    if (v <= 0) continue;
    let g = map.get(r.stage);
    if (!g) {
      g = { stage: r.stage, total: 0, rows: [] };
      map.set(r.stage, g);
    }
    g.total += v;
    g.rows.push({
      id: `${r.stage}::${r.label}`,
      label: r.label,
      value: v,
      count: r.call_count,
    });
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function SpendTreemap({ rows }: { rows: SpendBreakdownRow[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hover, setHover] = useState<RenderedCell | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const groups = groupByStage(rows);
  const total = groups.reduce((s, g) => s + g.total, 0);
  const cells: RenderedCell[] = [];
  if (size.w > 0 && size.h > 0 && total > 0) {
    const outer = squarify(
      groups.map((g) => ({ id: g.stage, value: g.total })),
      size.w,
      size.h,
    );
    const byStage = new Map(outer.map((r) => [r.id, r]));
    for (const g of groups) {
      const o = byStage.get(g.stage);
      if (!o) continue;
      // Reserve a header strip for the stage name when there's room.
      const showHeader = o.h > HEADER_HEIGHT + 12 && o.w > 60;
      const innerBox = {
        x: o.x + PADDING,
        y: o.y + PADDING + (showHeader ? HEADER_HEIGHT : 0),
        w: Math.max(0, o.w - PADDING * 2),
        h: Math.max(0, o.h - PADDING * 2 - (showHeader ? HEADER_HEIGHT : 0)),
      };
      if (innerBox.w <= 0 || innerBox.h <= 0) continue;
      const inner = squarify(
        g.rows.map((r) => ({ id: r.id, value: r.value })),
        innerBox.w,
        innerBox.h,
      );
      const rowMeta = new Map(g.rows.map((r) => [r.id, r]));
      for (const rect of inner) {
        const meta = rowMeta.get(rect.id);
        if (!meta) continue;
        cells.push({
          ...rect,
          x: rect.x + innerBox.x,
          y: rect.y + innerBox.y,
          stage: g.stage,
          label: meta.label,
          count: meta.count,
          outer: o,
        });
      }
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <h2 className="section-title" style={{ margin: "0 0 8px" }}>
          Spend hierarchy
        </h2>
        <div style={{ opacity: 0.6, fontSize: 13 }}>No paid calls in this window.</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <h2 className="section-title" style={{ margin: 0 }}>
          Spend hierarchy
        </h2>
        <div style={{ fontSize: 11, opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>
          {formatCost(total, 2)} across {rows.length} call site{rows.length === 1 ? "" : "s"}
        </div>
      </div>

      <div
        ref={containerRef}
        className="spend-treemap"
        style={{ position: "relative", width: "100%" }}
      >
        {/* Stage headers */}
        {groups.map((g) => {
          const o = cells.find((c) => c.stage === g.stage)?.outer;
          if (!o) return null;
          const showHeader = o.h > HEADER_HEIGHT + 12 && o.w > 60;
          if (!showHeader) return null;
          return (
            <div
              key={`hdr-${g.stage}`}
              style={{
                position: "absolute",
                left: o.x + PADDING,
                top: o.y + PADDING,
                width: Math.max(0, o.w - PADDING * 2),
                height: HEADER_HEIGHT,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-foreground)",
                pointerEvents: "none",
                whiteSpace: "nowrap",
                overflow: "hidden",
              }}
            >
              <span
                aria-hidden
                className="stage-dot"
                style={{ background: stageColor(g.stage) }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {g.stage}
              </span>
              <span style={{ opacity: 0.55, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                · {formatCost(g.total, 2)}
              </span>
            </div>
          );
        })}

        {/* Cells */}
        {cells.map((c) => {
          const color = stageColor(c.stage);
          const showLabel = c.w > 60 && c.h > 28;
          const showCost = c.w > 60 && c.h > 42;
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover((cur) => (cur?.id === c.id ? null : cur))}
              onFocus={() => setHover(c)}
              onBlur={() => setHover((cur) => (cur?.id === c.id ? null : cur))}
              title={`${c.stage} · ${c.label}\n${formatCost(c.value, 4)} · ${c.count} call${c.count === 1 ? "" : "s"}`}
              style={{
                position: "absolute",
                left: c.x,
                top: c.y,
                width: c.w,
                height: c.h,
                background: `color-mix(in srgb, ${color} 28%, var(--color-background))`,
                border: `1px solid ${color}`,
                borderRadius: 3,
                padding: "4px 6px",
                overflow: "hidden",
                cursor: "default",
                transition: "background 120ms ease",
                outline: "none",
              }}
            >
              {showLabel && (
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-foreground)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: 1.2,
                  }}
                >
                  {c.label}
                </div>
              )}
              {showCost && (
                <div
                  style={{
                    fontSize: 10.5,
                    opacity: 0.75,
                    fontVariantNumeric: "tabular-nums",
                    marginTop: 2,
                  }}
                >
                  {formatCost(c.value, c.value < 0.01 ? 4 : 3)} · {c.count}×
                </div>
              )}
            </div>
          );
        })}

        {/* Hover tooltip */}
        {hover && (
          <div
            style={{
              position: "absolute",
              left: Math.min(hover.x + hover.w + 8, size.w - 220),
              top: Math.max(hover.y - 4, 0),
              maxWidth: 220,
              background: "var(--color-background)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 12,
              boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span aria-hidden className="stage-dot" style={{ background: stageColor(hover.stage) }} />
              <span style={{ opacity: 0.7, fontSize: 11 }}>{hover.stage}</span>
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 600,
                wordBreak: "break-word",
                marginBottom: 4,
              }}
            >
              {hover.label}
            </div>
            <div style={{ fontSize: 11, opacity: 0.8, fontVariantNumeric: "tabular-nums" }}>
              {formatCost(hover.value, 4)} · {hover.count} call{hover.count === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
