"use client";

import { CandlestickChart, Clock3, Landmark } from "lucide-react";
import { useMemo, useState } from "react";

import type { HitRateMode } from "@/lib/hit-rate-aggregate";
import type { HorizonAccuracy, HorizonKey, HorizonMetric } from "@/lib/hit-rate-horizons";

function pct(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/A";
}

function HorizonCard({
  metric,
  selected = false,
  onSelect,
}: {
  metric: HorizonMetric;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-[color:var(--text-primary)]">{metric.label}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
            {metric.horizon === "current" ? "Live, changes with price" : "Fixed endpoint"}
          </p>
        </div>
        {metric.horizon === "current" ? (
          <span className="rounded-full border border-[color:var(--warning)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--warning)]">
            Current
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums text-[color:var(--success)]">{pct(metric.hit_rate_pct)}</p>
      <p className="mt-1 text-xs text-[color:var(--text-muted)]">
        {metric.hits} hits &middot; {metric.misses} misses &middot; N {metric.considered}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-[color:var(--border-subtle)] pt-3 text-center text-xs">
        <div>
          <dt className="text-[color:var(--text-muted)]">Pending</dt>
          <dd className="mt-1 font-semibold tabular-nums text-[color:var(--text-primary)]">{metric.pending}</dd>
        </div>
        <div>
          <dt className="text-[color:var(--text-muted)]">Neutral</dt>
          <dd className="mt-1 font-semibold tabular-nums text-[color:var(--text-primary)]">{metric.neutral}</dd>
        </div>
        <div>
          <dt className="text-[color:var(--text-muted)]">No price</dt>
          <dd className="mt-1 font-semibold tabular-nums text-[color:var(--text-primary)]">{metric.unavailable}</dd>
        </div>
      </dl>
    </>
  );

  const className = `w-full rounded-xl border p-3 text-left transition ${
    selected
      ? "border-[color:var(--accent)] bg-[color:var(--surface-overlay)]"
      : "border-[color:var(--border-subtle)] bg-[color:var(--surface)]"
  }`;

  return onSelect ? (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={`${className} hover:border-[color:var(--accent)]`}>
      {content}
    </button>
  ) : (
    <article className={className}>{content}</article>
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
  const [selectedFundamentalHorizon, setSelectedFundamentalHorizon] = useState<HorizonKey>("current");
  const selectedLabel = data?.fundamental.by_horizon.find((row) => row.horizon === selectedFundamentalHorizon)?.label || "Current";
  const modelRows = useMemo(
    () => (data?.fundamental.by_model || []).map((row) => ({
      ...row,
      metric: row.by_horizon.find((metric) => metric.horizon === selectedFundamentalHorizon),
    })),
    [data, selectedFundamentalHorizon],
  );

  return (
    <section className="rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--surface-overlay)] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--accent)] bg-[color:var(--surface)] text-[color:var(--accent)]">
          <Clock3 size={20} aria-hidden />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Time-aware audit</p>
          <h2 className="mt-1 font-display text-2xl text-[color:var(--text-primary)]">Directional Accuracy by Horizon</h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-[color:var(--text-muted)]">
            Each fixed window freezes the outcome at its first available market close. Pending calls stay outside the denominator. Current preserves the live, moving comparison used by the original Hit Rate.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
          <div className="flex items-start gap-3">
            <CandlestickChart size={20} className="mt-0.5 shrink-0 text-[color:var(--accent)]" aria-hidden />
            <div>
              <h3 className="font-semibold text-[color:var(--text-primary)]">Technical Analysis</h3>
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
                Bullish and bearish chart calls are evaluated at short, fixed windows. Neutral calls are shown as abstentions and are not counted as hits or misses.
              </p>
            </div>
          </div>
          {data?.technical.by_horizon?.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {data.technical.by_horizon.map((metric) => <HorizonCard key={metric.horizon} metric={metric} />)}
            </div>
          ) : <div className="mt-4"><EmptyState /></div>}
        </article>

        <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
          <div className="flex items-start gap-3">
            <Landmark size={20} className="mt-0.5 shrink-0 text-[color:var(--accent)]" aria-hidden />
            <div>
              <h3 className="font-semibold text-[color:var(--text-primary)]">Fundamental &amp; Valuation Targets</h3>
              <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
                Target-price directions are judged over longer windows. {mode === "positive_only" ? "Positive Only includes targets above the report price." : "All mode includes both upside and downside target calls."} Select a window to inspect every model below.
              </p>
            </div>
          </div>
          {data?.fundamental.by_horizon?.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {data.fundamental.by_horizon.map((metric) => (
                <HorizonCard
                  key={metric.horizon}
                  metric={metric}
                  selected={metric.horizon === selectedFundamentalHorizon}
                  onSelect={() => setSelectedFundamentalHorizon(metric.horizon)}
                />
              ))}
            </div>
          ) : <div className="mt-4"><EmptyState /></div>}

          {data?.fundamental.by_horizon?.length ? (
            <div className="mt-5 overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)]">
              <div className="border-b border-[color:var(--border-subtle)] px-4 py-3">
                <h4 className="font-semibold text-[color:var(--text-primary)]">Models at {selectedLabel}</h4>
                <p className="mt-1 text-xs text-[color:var(--text-muted)]">Same reports and endpoint, separated by valuation model.</p>
              </div>
              <div className="space-y-2 p-3 md:hidden">
                {modelRows.map((row) => (
                  <article key={`${row.key}-mobile`} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[color:var(--text-primary)]">{row.label}</p>
                        <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                          {row.metric?.hits ?? 0} hits &middot; {row.metric?.misses ?? 0} misses &middot; {row.metric?.pending ?? 0} pending
                        </p>
                      </div>
                      <p className="text-xl font-bold tabular-nums text-[color:var(--success)]">{pct(row.metric?.hit_rate_pct ?? null)}</p>
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-xs uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left">Model</th>
                      <th className="px-3 py-3 text-right">Hit rate</th>
                      <th className="px-3 py-3 text-right">Hits</th>
                      <th className="px-3 py-3 text-right">Misses</th>
                      <th className="px-3 py-3 text-right">Evaluated</th>
                      <th className="px-4 py-3 text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelRows.map((row) => (
                      <tr key={row.key} className="border-t border-[color:var(--border-subtle)]">
                        <td className="px-4 py-3 font-semibold text-[color:var(--text-primary)]">{row.label}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-[color:var(--success)]">{pct(row.metric?.hit_rate_pct ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-[color:var(--text-secondary)]">{row.metric?.hits ?? 0}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-[color:var(--text-secondary)]">{row.metric?.misses ?? 0}</td>
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
