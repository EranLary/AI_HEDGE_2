"use client";

import { CandlestickChart, Clock3, Landmark } from "lucide-react";
import { useMemo, useState } from "react";

import type { HitRateMode } from "@/lib/hit-rate-aggregate";
import type { HorizonAccuracy, HorizonKey, HorizonMetric } from "@/lib/hit-rate-horizons";

function pct(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "Not ready";
}

function preferredHorizon(metrics: HorizonMetric[], fallback: HorizonKey): HorizonKey {
  return metrics.find((metric) => metric.horizon !== "current" && metric.considered > 0)?.horizon
    || metrics.find((metric) => metric.horizon === "current" && metric.considered > 0)?.horizon
    || metrics[0]?.horizon
    || fallback;
}

function pickerStatus(metric: HorizonMetric): string {
  if (metric.considered > 0) return `${metric.considered} evaluated`;
  if (metric.pending > 0) return `${metric.pending} pending`;
  return "No endpoint";
}

function HorizonPicker({
  metrics,
  selected,
  onSelect,
  label,
  panelId,
}: {
  metrics: HorizonMetric[];
  selected: HorizonKey;
  onSelect: (horizon: HorizonKey) => void;
  label: string;
  panelId: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2" aria-label={label} role="tablist">
      <div className="flex min-w-max gap-2 sm:grid sm:min-w-0 sm:grid-cols-5">
        {metrics.map((metric) => {
          const isSelected = metric.horizon === selected;
          return (
            <button
              key={metric.horizon}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={panelId}
              onClick={() => onSelect(metric.horizon)}
              className={`min-w-[7.5rem] snap-start rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] sm:min-w-0 ${
                isSelected
                  ? "border-[color:var(--accent)] bg-[color:var(--surface-overlay)]"
                  : "border-[color:var(--border-subtle)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)]"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[color:var(--text-primary)]">{metric.label}</span>
                {metric.horizon === "current" ? (
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--warning)]">Live</span>
                ) : null}
              </span>
              <span className="mt-1 block text-lg font-bold tabular-nums text-[color:var(--text-primary)]">{pct(metric.hit_rate_pct)}</span>
              <span className="mt-0.5 block text-[10px] text-[color:var(--text-muted)]">{pickerStatus(metric)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HorizonDetail({ metric, id }: { metric: HorizonMetric; id: string }) {
  const hitShare = metric.considered > 0 ? (metric.hits / metric.considered) * 100 : 0;
  const other = metric.neutral + metric.unavailable;

  return (
    <div
      id={id}
      role="tabpanel"
      aria-live="polite"
      className="mt-2 grid gap-4 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">{metric.label} hit rate</p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            metric.horizon === "current"
              ? "border-[color:var(--warning)] text-[color:var(--warning)]"
              : "border-[color:var(--border-subtle)] text-[color:var(--text-muted)]"
          }`}
          >
            {metric.horizon === "current" ? "Live · can change" : "Fixed close"}
          </span>
        </div>
        <p className="mt-2 text-4xl font-bold tabular-nums text-[color:var(--text-primary)]">{pct(metric.hit_rate_pct)}</p>
        <p className="mt-1 text-sm leading-relaxed text-[color:var(--text-muted)]">
          {metric.considered > 0
            ? `${metric.hits} of ${metric.considered} evaluated directional calls were correct.`
            : metric.pending > 0
              ? `${metric.pending} calls are still waiting for this horizon to close.`
              : "No calls have a usable endpoint for this horizon yet."}
        </p>
      </div>

      <div>
        {metric.considered > 0 ? (
          <div
            className="flex h-2 overflow-hidden rounded-full bg-[color:var(--border-subtle)]"
            aria-label={`${metric.hits} hits and ${metric.misses} misses`}
          >
            <span className="bg-[color:var(--success)]" style={{ width: `${hitShare}%` }} />
            <span className="bg-[color:var(--danger)]" style={{ width: `${100 - hitShare}%` }} />
          </div>
        ) : null}
        <dl className={`${metric.considered > 0 ? "mt-3 " : ""}grid grid-cols-2 gap-2 sm:grid-cols-4`}>
          <div className="rounded-lg bg-[color:var(--surface-elevated)] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Hits</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-[color:var(--success)]">{metric.hits}</dd>
          </div>
          <div className="rounded-lg bg-[color:var(--surface-elevated)] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Misses</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-[color:var(--danger)]">{metric.misses}</dd>
          </div>
          <div className="rounded-lg bg-[color:var(--surface-elevated)] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Pending</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-[color:var(--text-primary)]">{metric.pending}</dd>
          </div>
          <div className="rounded-lg bg-[color:var(--surface-elevated)] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Other</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-[color:var(--text-primary)]">{other}</dd>
            <p className="text-[9px] text-[color:var(--text-muted)]">Neutral or unavailable</p>
          </div>
        </dl>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface)] p-5 text-sm text-[color:var(--text-muted)]">
      Horizon accuracy will appear when reports contain a frozen baseline price and the required market-price endpoint is available.
    </div>
  );
}

export function HorizonAccuracySection({
  data,
  mode,
}: {
  data: HorizonAccuracy | null | undefined;
  mode: HitRateMode;
}) {
  const [technicalChoice, setTechnicalChoice] = useState<HorizonKey | null>(null);
  const [fundamentalChoice, setFundamentalChoice] = useState<HorizonKey | null>(null);
  const [showAllMobileModels, setShowAllMobileModels] = useState(false);
  const technicalMetrics = data?.technical.by_horizon || [];
  const fundamentalMetrics = data?.fundamental.by_horizon || [];
  const selectedTechnicalHorizon = technicalChoice || preferredHorizon(technicalMetrics, "1d");
  const selectedFundamentalHorizon = fundamentalChoice || preferredHorizon(fundamentalMetrics, "6m");
  const selectedTechnicalMetric = technicalMetrics.find((metric) => metric.horizon === selectedTechnicalHorizon);
  const selectedFundamentalMetric = fundamentalMetrics.find((metric) => metric.horizon === selectedFundamentalHorizon);
  const modelRows = useMemo(
    () => (data?.fundamental.by_model || [])
      .map((row) => ({
        ...row,
        metric: row.by_horizon.find((metric) => metric.horizon === selectedFundamentalHorizon),
      }))
      .sort((a, b) => {
        if (a.key === "Consensus") return -1;
        if (b.key === "Consensus") return 1;
        const sampleDifference = (b.metric?.considered || 0) - (a.metric?.considered || 0);
        if (sampleDifference) return sampleDifference;
        return a.label.localeCompare(b.label);
      }),
    [data, selectedFundamentalHorizon],
  );
  const selectedFundamentalLabel = selectedFundamentalMetric?.label || "Selected horizon";
  const visibleMobileModels = showAllMobileModels ? modelRows : modelRows.slice(0, 5);

  return (
    <section id="horizon-accuracy" className="scroll-mt-24 rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--surface-overlay)] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--accent)] bg-[color:var(--surface)] text-[color:var(--accent)]">
          <Clock3 size={20} aria-hidden />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Accuracy over time</p>
          <h2 className="mt-1 font-display text-2xl text-[color:var(--text-primary)]">Hit Rate by Time Horizon</h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-[color:var(--text-muted)]">
            Choose a window to see how calls performed when that period closed. Fixed windows never change after evaluation; Current is a live snapshot.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-medium text-[color:var(--text-secondary)]">
            <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-2.5 py-1">Evaluated = hits + misses</span>
            <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-2.5 py-1">Pending excluded from hit rate</span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
          <div className="flex items-start gap-3">
            <CandlestickChart size={20} className="mt-0.5 shrink-0 text-[color:var(--accent)]" aria-hidden />
            <div>
              <h3 className="font-semibold text-[color:var(--text-primary)]">Technical Analysis</h3>
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
                Short-term bullish and bearish chart calls. Select a window to compare the signal with the market close after that period.
              </p>
            </div>
          </div>
          {technicalMetrics.length && selectedTechnicalMetric ? (
            <div className="mt-4">
              <HorizonPicker metrics={technicalMetrics} selected={selectedTechnicalHorizon} onSelect={setTechnicalChoice} label="Technical analysis time horizon" panelId="technical-horizon-detail" />
              <HorizonDetail metric={selectedTechnicalMetric} id="technical-horizon-detail" />
            </div>
          ) : <div className="mt-4"><EmptyState /></div>}
        </article>

        <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
          <div className="flex items-start gap-3">
            <Landmark size={20} className="mt-0.5 shrink-0 text-[color:var(--accent)]" aria-hidden />
            <div>
              <h3 className="font-semibold text-[color:var(--text-primary)]">Fundamental &amp; Valuation Targets</h3>
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
                Longer-term target-price direction. {mode === "positive_only" ? "Positive Only includes targets above the report price." : "All includes both upside and downside targets."}
              </p>
            </div>
          </div>
          {fundamentalMetrics.length && selectedFundamentalMetric ? (
            <div className="mt-4">
              <HorizonPicker metrics={fundamentalMetrics} selected={selectedFundamentalHorizon} onSelect={setFundamentalChoice} label="Fundamental analysis time horizon" panelId="fundamental-horizon-detail" />
              <HorizonDetail metric={selectedFundamentalMetric} id="fundamental-horizon-detail" />
            </div>
          ) : <div className="mt-4"><EmptyState /></div>}

          {fundamentalMetrics.length ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)]">
              <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[color:var(--border-subtle)] px-4 py-3">
                <div>
                  <h4 className="font-semibold text-[color:var(--text-primary)]">Model breakdown · {selectedFundamentalLabel}</h4>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">Same endpoint, split by valuation model.</p>
                </div>
                <p className="text-xs tabular-nums text-[color:var(--text-muted)]">{modelRows.length} models</p>
              </div>
              <div className="space-y-2 p-3 md:hidden">
                {visibleMobileModels.map((row) => (
                  <article key={`${row.key}-mobile`} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[color:var(--text-primary)]">{row.label}</p>
                        <p className="mt-1 text-xs text-[color:var(--text-muted)]">{row.metric?.considered ?? 0} evaluated · {row.metric?.pending ?? 0} pending</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xl font-bold tabular-nums text-[color:var(--text-primary)]">{pct(row.metric?.hit_rate_pct ?? null)}</p>
                        <p className="text-[10px] tabular-nums text-[color:var(--text-muted)]">{row.metric?.hits ?? 0} hits · {row.metric?.misses ?? 0} misses</p>
                      </div>
                    </div>
                  </article>
                ))}
                {modelRows.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllMobileModels((value) => !value)}
                    className="w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2.5 text-xs font-semibold text-[color:var(--text-secondary)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
                  >
                    {showAllMobileModels ? "Show fewer models" : `Show all ${modelRows.length} models`}
                  </button>
                ) : null}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-[color:var(--surface-elevated)] text-xs uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left">Model</th>
                      <th className="px-3 py-3 text-right">Hit rate</th>
                      <th className="px-3 py-3 text-right">Record</th>
                      <th className="px-3 py-3 text-right">Evaluated</th>
                      <th className="px-4 py-3 text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelRows.map((row) => (
                      <tr key={row.key} className="border-t border-[color:var(--border-subtle)]">
                        <td className="px-4 py-3 font-semibold text-[color:var(--text-primary)]">{row.label}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-[color:var(--text-primary)]">{pct(row.metric?.hit_rate_pct ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-[color:var(--text-secondary)]">{row.metric?.hits ?? 0}–{row.metric?.misses ?? 0}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-[color:var(--text-secondary)]">{row.metric?.considered ?? 0}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-[color:var(--text-muted)]">{row.metric?.pending ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
