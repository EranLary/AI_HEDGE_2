"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { AutoFitMetric, buildCurrencyContext, fmtMoney, type CurrencyContext } from "@/components/hedge-dashboard";
import { targetPriceTone, type TargetPriceTone } from "@/lib/target-price-comparison";
import { useThemeTokens } from "@/lib/theme-tokens";
import {
  consensusBlendLabel,
  effectiveConsensusWeights,
  formatConsensusWeight,
} from "@/lib/consensus-components";

const CHART_TOKENS = ["--chart-grid", "--chart-current", "--chart-bull", "--chart-bear", "--chart-consensus"] as const;

const TARGET_TONE_CLASS: Record<TargetPriceTone, string> = {
  positive: "text-[color:var(--success)]",
  negative: "text-[color:var(--danger)]",
  neutral: "text-[color:var(--text-muted)]",
};

type ChartHoverState = {
  chartX?: number;
  chartY?: number;
  offset?: { top?: number; left?: number; width?: number; height?: number };
  yAxisMap?: Record<string, { scale?: (value: number) => number }>;
};

function targetChangePct(target: number | null, current: number | null): number | null {
  if (typeof target !== "number" || typeof current !== "number" || Math.abs(current) <= 1e-9) return null;
  return ((target - current) / current) * 100;
}

function fmtChangePct(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

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
  const tokens = useThemeTokens(CHART_TOKENS);
  const consensus = data?.valuation_hub?.consensus;
  const consensusCurrent =
    typeof consensus?.current_price === "number" && Number.isFinite(consensus.current_price)
      ? Number(consensus.current_price)
      : null;
  const consensusMean =
    typeof consensus?.mean_target_price === "number" && Number.isFinite(consensus.mean_target_price)
      ? Number(consensus.mean_target_price)
      : null;
  const consensusMedian =
    typeof consensus?.median_target_price === "number" && Number.isFinite(consensus.median_target_price)
      ? Number(consensus.median_target_price)
      : null;
  const consensusDecision =
    typeof consensus?.decision_target_price === "number" && Number.isFinite(consensus.decision_target_price)
      ? Number(consensus.decision_target_price)
      : consensusMean;
  const sectorWeighted = data?.valuation_hub?.sector_weighted_valuation;
  const sectorWeightedTarget =
    typeof consensus?.sector_weighted_target_price === "number" && Number.isFinite(consensus.sector_weighted_target_price)
      ? Number(consensus.sector_weighted_target_price)
      : typeof sectorWeighted?.target_price === "number" && Number.isFinite(sectorWeighted.target_price)
        ? Number(sectorWeighted.target_price)
        : null;
  const meanTone = targetPriceTone(consensusMean, consensusCurrent);
  const medianTone = targetPriceTone(consensusMedian, consensusCurrent);
  const sectorWeightedTone = targetPriceTone(sectorWeightedTarget, consensusCurrent);
  const consensusTone = targetPriceTone(consensusDecision, consensusCurrent);
  const targetWeights = effectiveConsensusWeights(consensus?.component_weights, {
    mean: typeof consensusMean === "number",
    median: typeof consensusMedian === "number",
    sector_weighted: typeof sectorWeightedTarget === "number",
  });
  const targetWeight = (key: "mean" | "median" | "sector_weighted") =>
    targetWeights.find((component) => component.key === key)?.weight ?? null;
  const blendLabel = consensusBlendLabel(targetWeights);

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

  const chartData = (() => {
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
    if (rows.length) {
      if (typeof consensusDecision === "number" && !rows.some((row) => row.name === "Consensus")) {
        rows.push({
          name: "Consensus",
          target: consensusDecision,
          aboveCurrent: typeof consensusCurrent === "number" ? consensusDecision >= consensusCurrent : true,
          performer: blendLabel || "Consensus blend",
          investment: data?.score_card?.decision_investment_amount ?? null,
        });
      }
      return rows;
    }
    return [
      { name: "Mean", target: consensusMean, aboveCurrent: true, performer: "Consensus", investment: null },
      { name: "Median", target: consensusMedian, aboveCurrent: true, performer: "Consensus", investment: null },
      { name: "Consensus", target: consensusDecision, aboveCurrent: true, performer: "Consensus", investment: null },
    ].filter((row): row is typeof row & { target: number } => typeof row.target === "number");
  })();

  const priceSummary = [
    {
      key: "current",
      label: "Current Price",
      value: consensusCurrent,
      changePct: null,
      detail: "Report reference",
      detailEmphasis: null,
      valueClass: "text-[color:var(--warning)]",
      featured: false,
    },
    {
      key: "mean",
      label: "Mean",
      value: consensusMean,
      changePct: targetChangePct(consensusMean, consensusCurrent),
      detail: targetWeight("mean") !== null ? `${formatConsensusWeight(targetWeight("mean")!)} consensus weight` : "Consensus component",
      detailEmphasis: null,
      valueClass: TARGET_TONE_CLASS[meanTone],
      featured: false,
    },
    {
      key: "median",
      label: "Median",
      value: consensusMedian,
      changePct: targetChangePct(consensusMedian, consensusCurrent),
      detail: targetWeight("median") !== null ? `${formatConsensusWeight(targetWeight("median")!)} consensus weight` : "Consensus component",
      detailEmphasis: null,
      valueClass: TARGET_TONE_CLASS[medianTone],
      featured: false,
    },
    {
      key: "sector",
      label: "Sector-Weighted",
      value: sectorWeightedTarget,
      changePct: targetChangePct(sectorWeightedTarget, consensusCurrent),
      detail: targetWeight("sector_weighted") !== null ? `${formatConsensusWeight(targetWeight("sector_weighted")!)} consensus weight` : "Consensus component",
      detailEmphasis: sectorWeighted?.sector || "Sector policy",
      valueClass: TARGET_TONE_CLASS[sectorWeightedTone],
      featured: false,
    },
    {
      key: "consensus",
      label: "Consensus",
      value: consensusDecision,
      changePct: targetChangePct(consensusDecision, consensusCurrent),
      detail: blendLabel ? `${blendLabel} final blend` : "Final consensus blend",
      detailEmphasis: null,
      valueClass: TARGET_TONE_CLASS[consensusTone],
      featured: true,
    },
  ].filter((item) => typeof item.value === "number" && Number.isFinite(item.value));

  const chartScale = (() => {
    const values = chartData.map((x) => Number(x.target)).filter((x) => Number.isFinite(x));
    if (typeof consensusCurrent === "number") values.push(consensusCurrent);
    if (typeof consensusMean === "number") values.push(consensusMean);
    if (typeof consensusMedian === "number") values.push(consensusMedian);
    if (typeof consensusDecision === "number") values.push(consensusDecision);
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
  })();

  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 });
  const [chartReady, setChartReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hide = () => setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setChartReady(rect.width > 0 && rect.height > 0);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [chartData.length]);

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
    <section className="mb-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
          <Gauge size={14} /> Target Price Overview
        </span>
        <span className="text-xs text-[color:var(--text-muted)]">Changes are measured against the report price</span>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        {priceSummary.map((item) => (
          <article
            key={item.key}
            className={`flex min-w-0 flex-col rounded-xl border p-3 ${
              item.featured
                ? "border-[color:var(--consensus-border)] bg-[color:var(--consensus-soft)]"
                : "border-[color:var(--border-subtle)] bg-[color:var(--surface)]"
            }`}
          >
            <div className="flex min-h-5 flex-wrap items-start justify-between gap-2">
              <p className={`text-[11px] font-semibold uppercase leading-4 tracking-[0.13em] ${item.featured ? "text-[color:var(--consensus-text)]" : "text-[color:var(--text-secondary)]"}`}>
                {item.label}
              </p>
              {item.featured ? (
                <span className="rounded-full border border-[color:var(--consensus-border)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[color:var(--consensus-text)]">
                  Final
                </span>
              ) : null}
            </div>
            <AutoFitMetric
              text={fmtMoney(item.value, currencyContext, "price")}
              maxPx={20}
              minPx={12}
              className={`mt-2 w-full min-w-0 overflow-hidden whitespace-nowrap font-bold leading-tight tabular-nums ${item.valueClass}`}
            />
            <div className="mt-2 min-h-4 text-[11px] leading-4">
              {typeof item.changePct === "number" ? (
                <span className={`block font-semibold ${TARGET_TONE_CLASS[targetPriceTone(item.value, consensusCurrent)]}`}>
                  {fmtChangePct(item.changePct)} vs current
                </span>
              ) : (
                <span className="block font-semibold text-[color:var(--text-muted)]">Baseline</span>
              )}
            </div>
            <div className="mt-2 min-h-9 text-[11px] leading-4">
              {item.detailEmphasis ? (
                <span className="block font-semibold text-[color:var(--text-secondary)]">{item.detailEmphasis}</span>
              ) : null}
              <span className="block text-[color:var(--text-muted)]">{item.detail}</span>
            </div>
          </article>
        ))}
      </div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
        Target price by model
      </p>
      <div ref={wrapRef} className="hib-chart relative h-96 min-h-[16rem] min-w-0">
        {chartReady ? (
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
          <BarChart data={chartData} onMouseMove={handleMouseMove} onMouseLeave={hide}>
            <CartesianGrid strokeDasharray="3 3" stroke={tokens["--chart-grid"]} />
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
                stroke={tokens["--chart-current"]}
                strokeWidth={2.5}
                strokeDasharray="6 4"
              />
            ) : null}
            <Bar dataKey="target" radius={[6, 6, 0, 0]} isAnimationActive activeBar={false}>
              {chartData.map((entry) => (
                <Cell
                  key={`target-${entry.name}`}
                  fill={entry.name === "Consensus" ? tokens["--chart-consensus"] : entry.aboveCurrent ? tokens["--chart-bull"] : tokens["--chart-bear"]}
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
        ) : (
          <div className="h-full w-full rounded-xl border border-white/10 bg-black/25" />
        )}
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
