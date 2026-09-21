"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Database, Gauge } from "lucide-react";
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
import {
  finiteShareCount,
  formatCompactShares,
  formatFullShares,
  resolvedShareCount,
  shareCountChanged,
  shareCountDelta,
} from "@/lib/share-count-display";
import { targetPriceTone, type TargetPriceTone } from "@/lib/target-price-comparison";
import { useThemeTokens } from "@/lib/theme-tokens";

const CHART_TOKENS = ["--chart-grid", "--chart-current", "--chart-bull", "--chart-bear"] as const;

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

function shareCountSourceLabel(value: unknown): string {
  if (value === "official_filing") return "Official filing";
  if (value === "provider_fallback") return "Yahoo fallback";
  return "Unavailable";
}

function providerCandidateLabel(value: string): string {
  if (value === "current_valuation_denominator") return "Original denominator";
  if (value === "provider_implied_shares") return "Yahoo implied shares";
  if (value === "market_cap_div_current_price") return "Market cap ÷ price";
  return value.replaceAll("_", " ");
}

function ShareCountDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-xs font-semibold tabular-nums text-[color:var(--text-primary)]">{value}</dd>
    </div>
  );
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
  const meanTone = targetPriceTone(consensusMean, consensusCurrent);
  const medianTone = targetPriceTone(consensusMedian, consensusCurrent);
  const consensusTone = targetPriceTone(consensusDecision, consensusCurrent);
  const shareResolution = data?.header?.share_count_resolution;
  const finalShares = resolvedShareCount(data?.header?.shares_outstanding, shareResolution);
  const originalShares = finiteShareCount(shareResolution?.original_yahoo_shares);
  const sharesChanged = shareCountChanged(shareResolution);
  const sharesDelta = shareCountDelta(shareResolution);
  const providerCandidates = Object.entries(shareResolution?.provider_candidates || {}).filter(
    ([, value]) => finiteShareCount(value) !== null,
  );
  const [shareDetailsOpen, setShareDetailsOpen] = useState(false);
  const shareDetailsId = useId();

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
      { name: "Mean", target: consensusMean, aboveCurrent: true, performer: "Consensus", investment: null },
      { name: "Median", target: consensusMedian, aboveCurrent: true, performer: "Consensus", investment: null },
    ].filter((row): row is typeof row & { target: number } => typeof row.target === "number");
  }, [consensusCurrent, consensusMean, consensusMedian, data?.valuation_hub?.method_blocks, methodPerformerByName]);

  const chartScale = useMemo(() => {
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
  }, [chartData, consensusCurrent, consensusDecision, consensusMean, consensusMedian]);

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

  useEffect(() => {
    if (!shareDetailsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShareDetailsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [shareDetailsOpen]);

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
      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2 text-zinc-200">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
            <Gauge size={14} /> Target Price by Model
          </span>
          {finalShares !== null ? (
            <button
              type="button"
              aria-expanded={shareDetailsOpen}
              aria-controls={shareDetailsId}
              onClick={() => setShareDetailsOpen((open) => !open)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold tabular-nums transition ${
                sharesChanged
                  ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)] hover:border-[color:var(--warning)]"
                  : "border-[color:var(--border-subtle)] bg-[color:var(--surface)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]"
              }`}
            >
              <Database size={12} aria-hidden="true" />
              Shares {formatCompactShares(finalShares)}
              {sharesChanged ? <span className="text-[9px] uppercase tracking-[0.1em]">Adjusted</span> : null}
              <ChevronDown
                size={12}
                aria-hidden="true"
                className={`transition-transform ${shareDetailsOpen ? "rotate-180" : ""}`}
              />
            </button>
          ) : null}
          <span className="text-xs text-[color:var(--text-muted)]">
            Current {fmtMoney(consensusCurrent, currencyContext, "price")} <span aria-hidden="true">·</span>{" "}
            <span className={TARGET_TONE_CLASS[meanTone]}>Mean {fmtMoney(consensusMean, currencyContext, "price")}</span>{" "}
            <span aria-hidden="true">·</span>{" "}
            <span className={TARGET_TONE_CLASS[medianTone]}>Median {fmtMoney(consensusMedian, currencyContext, "price")}</span>{" "}
            <span aria-hidden="true">·</span>{" "}
            <span className={TARGET_TONE_CLASS[consensusTone]}>Consensus {fmtMoney(consensusDecision, currencyContext, "price")}</span>
          </span>
          <span className="hidden">
            Mean {fmtMoney(consensusMean, currencyContext, "price")} · Median {fmtMoney(consensusMedian, currencyContext, "price")}
          </span>
        </div>
        {shareDetailsOpen && finalShares !== null ? (
          <section
            id={shareDetailsId}
            aria-label="Valuation share-count details"
            className={`mt-3 max-h-[28rem] overflow-auto rounded-xl border p-3 shadow-lg ${
              sharesChanged
                ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]"
                : "border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-primary)]">
                  Valuation share count
                </p>
                <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
                  {!shareResolution
                    ? "This historical report stores the final denominator, but not the agent comparison details."
                    : sharesChanged
                      ? "The filing-grounded agent replaced the original Yahoo denominator."
                      : shareResolution.source_type === "official_filing"
                        ? "The filing review confirmed the same denominator as Yahoo."
                        : "The agent kept the original Yahoo denominator."}
                </p>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                  sharesChanged
                    ? "border-[color:var(--warning-border)] text-[color:var(--warning)]"
                    : "border-[color:var(--border-subtle)] text-[color:var(--text-muted)]"
                }`}
              >
                {sharesChanged ? "Adjusted" : shareResolution ? "Unchanged" : "Historical"}
              </span>
            </div>

            <dl className="mt-3 grid gap-2 sm:grid-cols-3">
              <ShareCountDetail label="Original Yahoo" value={formatFullShares(originalShares)} />
              <ShareCountDetail label="Final used" value={formatFullShares(finalShares)} />
              <ShareCountDetail
                label="Difference"
                value={
                  sharesDelta
                    ? Math.abs(sharesDelta.count) <= 0.5
                      ? "No change"
                      : `${sharesDelta.count >= 0 ? "+" : "−"}${formatFullShares(Math.abs(sharesDelta.count))} (${sharesDelta.percent >= 0 ? "+" : ""}${sharesDelta.percent.toFixed(2)}%)`
                    : originalShares !== null
                      ? "No change"
                      : "N/A"
                }
              />
            </dl>

            {shareResolution ? (
              <dl className="mt-2 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                <div><dt className="text-[color:var(--text-muted)]">Source</dt><dd className="font-medium text-[color:var(--text-primary)]">{shareCountSourceLabel(shareResolution.source_type)}</dd></div>
                <div><dt className="text-[color:var(--text-muted)]">Confidence</dt><dd className="font-medium text-[color:var(--text-primary)]">{shareResolution.confidence || "N/A"}</dd></div>
                <div><dt className="text-[color:var(--text-muted)]">As of</dt><dd className="font-medium text-[color:var(--text-primary)]">{shareResolution.as_of_date || "Not stated"}</dd></div>
                <div><dt className="text-[color:var(--text-muted)]">Status</dt><dd className="font-medium capitalize text-[color:var(--text-primary)]">{shareResolution.status || "Unavailable"}</dd></div>
                {shareResolution.basis ? <div className="sm:col-span-2"><dt className="text-[color:var(--text-muted)]">Basis</dt><dd className="font-medium text-[color:var(--text-primary)]">{shareResolution.basis}</dd></div> : null}
                {shareResolution.calculation ? <div className="sm:col-span-2"><dt className="text-[color:var(--text-muted)]">Calculation</dt><dd className="font-mono text-[color:var(--text-primary)]">{shareResolution.calculation}</dd></div> : null}
              </dl>
            ) : null}

            {shareResolution?.evidence_excerpt ? (
              <blockquote className="mt-3 max-h-28 overflow-auto rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2 text-xs leading-5 text-[color:var(--text-secondary)]">
                <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Official filing evidence</span>
                {shareResolution.evidence_excerpt}
              </blockquote>
            ) : shareResolution?.validation_note ? (
              <p className="mt-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2 text-xs leading-5 text-[color:var(--text-secondary)]">
                {shareResolution.validation_note}
              </p>
            ) : null}

            {providerCandidates.length > 1 ? (
              <div className="mt-3 border-t border-[color:var(--border-subtle)] pt-2">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Yahoo candidates checked</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[color:var(--text-secondary)]">
                  {providerCandidates.map(([key, value]) => (
                    <span key={key}>{providerCandidateLabel(key)}: <strong className="font-semibold tabular-nums text-[color:var(--text-primary)]">{formatFullShares(value)}</strong></span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
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
                  fill={entry.aboveCurrent ? tokens["--chart-bull"] : tokens["--chart-bear"]}
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
