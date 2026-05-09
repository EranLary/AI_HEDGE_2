"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ObsCallSummaryRow } from "@/lib/obs-db";
import { formatLatency } from "@/lib/obs-format";
import { callTitle } from "@/lib/obs-labels";
import { stageColor } from "@/lib/obs-styles";

type WaterfallParent = {
  id: string;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  stage: string;
};

type LinkMode = "panel" | "page";

type CallWaterfallProps = {
  runId: string;
  parent: WaterfallParent;
  children: ObsCallSummaryRow[];
  compact?: boolean;
  linkMode?: LinkMode;
  /** Used when linkMode === "page" so the back-button can know which view to return to. */
  backView?: "flow" | "hierarchy";
};

const PADDING_X = 12;
const LABEL_W_FULL = 180;
const LABEL_W_COMPACT = 110;
const META_W_FULL = 70;
const META_W_COMPACT = 56;
const TICK_AREA_H = 18;
const MIN_BAR_W = 2;

export function CallWaterfall({
  runId,
  parent,
  children,
  compact = false,
  linkMode = "panel",
  backView,
}: CallWaterfallProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const navigate = (callId: string) => {
    const href =
      linkMode === "page"
        ? `/runs/${runId}/calls/${callId}${backView === "flow" ? "?view=flow" : ""}`
        : `/runs/${runId}?call=${callId}`;
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerW(entry.contentRect.width);
    });
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const t0 = Date.parse(parent.started_at);
  const parentEnd = Date.parse(parent.ended_at);
  const sortedChildren = useMemo(
    () =>
      [...children].sort(
        (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
      ),
    [children],
  );

  if (
    !Number.isFinite(t0) ||
    !Number.isFinite(parentEnd) ||
    sortedChildren.length === 0
  ) {
    return null;
  }

  const tEnd = sortedChildren.reduce((acc, c) => {
    const ce = Date.parse(c.ended_at);
    return Number.isFinite(ce) ? Math.max(acc, ce) : acc;
  }, parentEnd);

  const totalMs = Math.max(tEnd - t0, 1);

  const labelW = compact ? LABEL_W_COMPACT : LABEL_W_FULL;
  const metaW = compact ? META_W_COMPACT : META_W_FULL;
  const rowH = compact ? 22 : 28;
  const barH = compact ? 12 : 16;
  const fontSize = compact ? 10.5 : 12;
  const titleSize = compact ? 11 : 12.5;

  const rowCount = sortedChildren.length + 1;
  const chartH = rowCount * rowH + TICK_AREA_H + 6;

  const trackX = labelW + 8;
  const trackEnd = Math.max(containerW - metaW - 4, trackX + 60);
  const trackW = Math.max(trackEnd - trackX, 60);

  const xFor = (ms: number) => trackX + (ms / totalMs) * trackW;
  const wFor = (ms: number) => Math.max((ms / totalMs) * trackW, MIN_BAR_W);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    pos: p,
    ms: Math.round(totalMs * p),
  }));

  const parentColor = stageColor(parent.stage);

  return (
    <div
      ref={containerRef}
      className="card"
      style={{ padding: compact ? 10 : 12 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: compact ? 10.5 : 11,
            opacity: 0.65,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            fontWeight: 600,
          }}
        >
          Duration breakdown
        </div>
        <div
          style={{
            fontSize: compact ? 10 : 11,
            opacity: 0.55,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          total {formatLatency(totalMs)} · {sortedChildren.length} sub-call
          {sortedChildren.length === 1 ? "" : "s"}
        </div>
      </div>
      {containerW > 0 && (
        <svg
          width="100%"
          height={chartH}
          viewBox={`0 0 ${containerW} ${chartH}`}
          style={{ overflow: "visible", display: "block" }}
        >
          {/* tick lines */}
          {ticks.map((t) => (
            <line
              key={`tick-${t.pos}`}
              x1={xFor(t.ms)}
              x2={xFor(t.ms)}
              y1={TICK_AREA_H - 4}
              y2={chartH - 6}
              stroke="var(--color-border)"
              strokeWidth={0.6}
              strokeDasharray="2 3"
              opacity={0.5}
            />
          ))}
          {/* tick labels */}
          {ticks.map((t) => (
            <text
              key={`label-${t.pos}`}
              x={xFor(t.ms)}
              y={TICK_AREA_H - 8}
              fontSize={compact ? 9.5 : 10}
              textAnchor={
                t.pos === 0 ? "start" : t.pos === 1 ? "end" : "middle"
              }
              fill="currentColor"
              opacity={0.55}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatLatency(t.ms)}
            </text>
          ))}

          {/* parent baseline row */}
          <text
            x={PADDING_X}
            y={TICK_AREA_H + rowH / 2 + 4}
            fontSize={titleSize}
            fontWeight={600}
            fill="currentColor"
            opacity={0.85}
          >
            self
          </text>
          <rect
            x={trackX}
            y={TICK_AREA_H + (rowH - barH) / 2}
            width={trackW}
            height={barH}
            rx={3}
            fill={parentColor}
            fillOpacity={0.18}
            stroke={parentColor}
            strokeOpacity={0.55}
            strokeWidth={1}
          />
          <text
            x={Math.min(containerW - 4, trackX + trackW + 6)}
            y={TICK_AREA_H + rowH / 2 + 4}
            fontSize={fontSize}
            textAnchor="end"
            fill="currentColor"
            opacity={0.7}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatLatency(parent.latency_ms)}
          </text>

          {/* children rows */}
          {sortedChildren.map((c, i) => {
            const cs = Date.parse(c.started_at);
            const ms = Number.isFinite(cs) ? cs - t0 : 0;
            const dur = Math.max(c.latency_ms, 0);
            const x = xFor(Math.max(ms, 0));
            const w = wFor(dur);
            const y = TICK_AREA_H + (i + 1) * rowH + (rowH - barH) / 2;
            const color = stageColor(c.stage);
            const labelText = callTitle(c);

            return (
              <g
                key={c.id}
                style={{ cursor: "pointer" }}
                onClick={() => navigate(c.id)}
              >
                <rect
                  x={0}
                  y={TICK_AREA_H + (i + 1) * rowH - 1}
                  width={containerW}
                  height={rowH}
                  fill="transparent"
                />
                <text
                  x={PADDING_X}
                  y={TICK_AREA_H + (i + 1) * rowH + rowH / 2 + 4}
                  fontSize={titleSize}
                  fontWeight={500}
                  fill="currentColor"
                  opacity={0.85}
                  style={{ pointerEvents: "none" }}
                >
                  {truncate(labelText, compact ? 14 : 24)}
                </text>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={barH}
                  rx={3}
                  fill={color}
                  fillOpacity={0.7}
                  stroke={color}
                  strokeOpacity={1}
                  strokeWidth={1}
                />
                <text
                  x={Math.min(containerW - 4, trackX + trackW + 6)}
                  y={TICK_AREA_H + (i + 1) * rowH + rowH / 2 + 4}
                  fontSize={fontSize}
                  textAnchor="end"
                  fill="currentColor"
                  opacity={0.7}
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    pointerEvents: "none",
                  }}
                >
                  {formatLatency(dur)}
                </text>
                <title>
                  {labelText} · starts at +{formatLatency(Math.max(ms, 0))} ·{" "}
                  {formatLatency(dur)}
                </title>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
