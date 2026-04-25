"use client";

import { useMemo, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { buildCurrencyContext, fmtMoney, type CurrencyContext } from "@/components/hedge-dashboard";

type ChartHoverState = {
  chartX?: number;
  chartY?: number;
  offset?: { top?: number; left?: number; width?: number; height?: number };
  yAxisMap?: Record<string, { scale?: (value: number) => number }>;
};

function ChartHoverTooltip({
  active,
  payload,
  currencyContext,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { name?: string; target?: number } }>;
  currencyContext: CurrencyContext;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || !row.name) return null;
  return (
    <div className="hib-chart-tooltip rounded-lg border border-white/15 bg-zinc-950/95 px-3 py-2 shadow-xl">
      <p className="text-xs font-semibold tracking-[0.08em] text-zinc-100">{row.name}</p>
      <p className="text-sm font-medium text-zinc-200">{fmtMoney(row.target, currencyContext, "price")}</p>
    </div>
  );
}

export function TargetPriceChart({ data }: { data: DashboardPayload | null }) {
  const currencyContext = useMemo(() => buildCurrencyContext(data), [data]);
  const consensus = data?.valuation_hub?.consensus;
  const consensusCurrent =
    typeof consensus?.current_price === "number" && Number.isFinite(consensus.current_price)
      ? Number(consensus.current_price)
      : null;

  const methodTabs = useMemo(() => data?.valuation_hub?.method_tabs || [], [data?.valuation_hub?.method_tabs]);
  const methodPerformerByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const tab of methodTabs) {
      const performers = Array.from(
        new Set(
          (tab.outputs || [])
            .map((o) => String(o.persona || "").trim())
            .filter(Boolean),
        ),
      );
      map.set(tab.name, performers.length ? performers.join(", ") : "Model Aggregate");
    }
    return map;
  }, [methodTabs]);

  const chartData = useMemo(() => {
    const blocks = data?.valuation_hub?.method_blocks || [];
    const rows = blocks
      .filter((b) => typeof b.target_price === "number" && Number.isFinite(Number(b.target_price)))
      .map((b) => ({
        name: b.name,
        target: Number(b.target_price),
        aboveCurrent: typeof consensusCurrent === "number" ? Number(b.target_price) >= consensusCurrent : true,
        performer: methodPerformerByName.get(b.name) || "Model Aggregate",
        investment: b.investment_amount,
      }));
    if (rows.length) return rows;
    return [
      { name: "Mean", target: Number(consensus?.mean_target_price || 0), aboveCurrent: true, performer: "Consensus", investment: null },
      { name: "Current", target: Number(consensus?.current_price || 0), aboveCurrent: true, performer: "Market", investment: null },
    ];
  }, [consensus, consensusCurrent, data?.valuation_hub?.method_blocks, methodPerformerByName]);

  const chartScale = useMemo(() => {
    const values = chartData.map((x) => Number(x.target)).filter((x) => Number.isFinite(x));
    if (typeof consensusCurrent === "number") values.push(consensusCurrent);
    if (!values.length) return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], currentEpsilon: 0.001 };
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (Math.abs(max - min) < 1e-9) {
      const pad = Math.max(Math.abs(max) * 0.1, 1);
      min -= pad;
      max += pad;
    }
    const span = max - min;
    const margin = Math.max(span * 0.08, Math.max(Math.abs(max), Math.abs(min), 1) * 0.03);
    min -= margin;
    max += margin;
    const ticks: number[] = [];
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) ticks.push(min + ((max - min) * i) / steps);
    if (typeof consensusCurrent === "number") ticks.push(consensusCurrent);
    const uniqueTicks = Array.from(
      new Set(ticks.map((t) => Number(t.toFixed(6))).filter((t) => Number.isFinite(t))),
    ).sort((a, b) => a - b);
    return { min, max, ticks: uniqueTicks, currentEpsilon: Math.max((max - min) * 0.002, 1e-6) };
  }, [chartData, consensusCurrent]);

  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hide = () => setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));

  const handleMouseMove = (state: unknown) => {
    const hoverState: ChartHoverState | undefined =
      state && typeof state === "object" ? (state as ChartHoverState) : undefined;
    if (typeof consensusCurrent !== "number" || !Number.isFinite(consensusCurrent) || !wrapRef.current) {
      hide();
      return;
    }
    const chartX = Number(hoverState?.chartX);
    const chartY = Number(hoverState?.chartY);
    const offset = hoverState?.offset;
    if (!Number.isFinite(chartX) || !Number.isFinite(chartY) || !offset) {
      hide();
      return;
    }
    const yAxisMap = hoverState?.yAxisMap;
    const axisKey = yAxisMap ? Object.keys(yAxisMap)[0] : undefined;
    const axisState = axisKey && yAxisMap ? yAxisMap[axisKey] : undefined;
    const scaleFn = axisState?.scale ?? null;
    let lineY: number;
    if (typeof scaleFn === "function") {
      lineY = Number(scaleFn(consensusCurrent));
    } else {
      const span = chartScale.max - chartScale.min;
      if (!Number.isFinite(span) || Math.abs(span) < 1e-9) {
        hide();
        return;
      }
      const ratio = (chartScale.max - consensusCurrent) / span;
      lineY = Number(offset.top) + ratio * Number(offset.height || 0);
    }
    if (!Number.isFinite(lineY)) {
      hide();
      return;
    }
    const nearLine = Math.abs(chartY - lineY) <= 8;
    const insidePlot = chartX >= Number(offset.left) && chartX <= Number(offset.left) + Number(offset.width || 0);
    if (!nearLine || !insidePlot) {
      hide();
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const tipW = 220;
    const tipH = 32;
    const x = Math.max(10, Math.min(chartX + 12, rect.width - tipW - 10));
    const y = Math.max(8, Math.min(lineY - 28, rect.height - tipH - 8));
    setTooltip({ visible: true, x, y });
  };

  if (!chartData.length) return null;

  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-zinc-200">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
          <Gauge size={14} /> Target Price by Model
        </span>
      </div>
      <div ref={wrapRef} className="hib-chart relative h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} onMouseMove={handleMouseMove} onMouseLeave={hide}>
            <CartesianGrid strokeDasharray="3 3" stroke="#29303a" />
            <XAxis dataKey="name" tick={false} axisLine={false} tickLine={false} />
            <YAxis
              width={140}
              domain={[chartScale.min, chartScale.max]}
              ticks={chartScale.ticks}
              tickFormatter={(v) => {
                const value = Number(v);
                const label = fmtMoney(value, currencyContext, "price");
                if (
                  typeof consensusCurrent === "number" &&
                  Math.abs(value - consensusCurrent) <= chartScale.currentEpsilon
                ) {
                  return `${label} Current`;
                }
                return label;
              }}
            />
            {Number(consensus?.current_price || 0) > 0 ? (
              <ReferenceLine
                y={Number(consensus?.current_price || 0)}
                stroke="#f59e0b"
                strokeWidth={2.5}
                strokeDasharray="6 4"
              />
            ) : null}
            <Bar dataKey="target" radius={[6, 6, 0, 0]} isAnimationActive activeBar={false}>
              {chartData.map((entry) => (
                <Cell
                  key={`target-${entry.name}`}
                  fill={entry.aboveCurrent ? "#22c55e" : "#ef4444"}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </Bar>
            <Tooltip
              cursor={false}
              content={<ChartHoverTooltip currencyContext={currencyContext} />}
              wrapperStyle={{ outline: "none" }}
            />
          </BarChart>
        </ResponsiveContainer>
        {tooltip.visible ? (
          <div
            className="hib-line-tooltip pointer-events-none absolute z-20 rounded-md border px-2 py-1 text-[11px] shadow-lg"
            style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          >
            Current Price: {fmtMoney(consensusCurrent, currencyContext, "price")}
          </div>
        ) : null}
      </div>
    </section>
  );
}
