"use client";

import { BrainCircuit, CalendarClock, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useWorkspace } from "@/components/shell/workspace-context";
import {
  JEV_HORIZON_ORDER,
  type JevHorizon,
  type JevMetrics,
  type JevPredictionScope,
} from "@/lib/jev-metrics";

type JevTrackRecordPayload = JevMetrics & {
  generated_at: string;
  workspace: string;
};

const HORIZON_LABELS: Record<JevHorizon, string> = {
  "1w": "1 Week",
  "1m": "1 Month",
  "3m": "3 Months",
  "6m": "6 Months",
  "1y": "1 Year",
  "3y": "3 Years",
  "5y": "5 Years",
};

function pct(value: number | null, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}%` : "N/A";
}

function probabilityPct(value: number | null, digits = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "N/A";
}

function score(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "N/A";
}

function dateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function clampPct(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function SummaryCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">{title}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-[color:var(--text-primary)]">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-[color:var(--text-muted)]">{detail}</p>
    </article>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_unused, index) => (
        <div key={index} className="h-28 animate-pulse rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)]" />
      ))}
    </div>
  );
}

export function JevTrackRecordSection() {
  const { api, label: workspaceLabel, workspace } = useWorkspace();
  const [scope, setScope] = useState<JevPredictionScope>("positive_only");
  const [data, setData] = useState<JevTrackRecordPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          api(`/api/jev-track-record?scope=${scope}&refresh=${refreshToken}`),
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as JevTrackRecordPayload;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) {
          setData(null);
          setError("Jev performance data is temporarily unavailable.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [api, refreshToken, scope, workspace]);

  const lastTimelineDate = useMemo(() => data?.timeline.at(-1)?.date || null, [data]);

  return (
    <section className="mt-8 rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--surface-overlay)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--accent)] bg-[color:var(--surface)] text-[color:var(--accent)]">
            <BrainCircuit size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Probabilistic audit</p>
            <h2 className="mt-1 font-display text-2xl text-[color:var(--text-primary)]">Jev Track Record</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[color:var(--text-muted)]">
              Direction accuracy and probability calibration for every matured Jev forecast in {workspaceLabel}.
              Historical backfill and live forward forecasts are measured together. Hit rate says whether YES/NO was right;
              Brier and calibration show whether the confidence was honest.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-1" aria-label="Jev prediction scope">
            {(["positive_only", "all"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setScope(item)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                  scope === item
                    ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                    : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                {item === "positive_only" ? "Positive Only" : "All"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRefreshToken((value) => value + 1)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)]"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[color:var(--text-muted)]">
        {scope === "positive_only"
          ? "Positive only measures Jev's YES calls: forecasts with at least a 50% probability of a price increase."
          : "All calls measures both Jev YES and NO direction forecasts."}
      </p>

      <div className="mt-5">
        {loading ? <LoadingState /> : null}
        {!loading && error ? (
          <div className="rounded-xl border border-[color:var(--danger)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--danger)]">{error}</div>
        ) : null}
        {!loading && data ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                title="Hit rate"
                value={pct(data.overall.hit_rate_pct)}
                detail={`${data.overall.hits} hits · ${data.overall.misses} misses from ${data.overall.resolved} resolved forecasts`}
              />
              <SummaryCard
                title="Brier score"
                value={score(data.overall.mean_brier_score)}
                detail="Probability error: 0 is perfect and lower is better"
              />
              <SummaryCard
                title="Calibration error"
                value={probabilityPct(data.expected_calibration_error)}
                detail="Weighted gap between predicted and observed up rates"
              />
              <SummaryCard
                title="Coverage"
                value={String(data.reports)}
                detail={`${data.overall.predictions} predictions · ${data.overall.pending} awaiting their evaluation date`}
              />
            </div>

            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CalendarClock size={16} className="text-[color:var(--accent)]" aria-hidden />
                    <h3 className="font-semibold text-[color:var(--text-primary)]">Evidence timeline</h3>
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                    Cumulative performance after each date on which one or more forecast horizons matured.
                  </p>
                </div>
                {lastTimelineDate ? (
                  <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--text-secondary)]">
                    Through {dateLabel(lastTimelineDate)}
                  </span>
                ) : null}
              </div>

              {data.timeline.length ? (
                <div className="mt-4 overflow-x-auto pb-2">
                  <div
                    className="grid min-w-max gap-3"
                    style={{ gridTemplateColumns: `repeat(${data.timeline.length}, minmax(180px, 1fr))` }}
                  >
                    {data.timeline.map((point, index) => (
                      <article key={`${point.date}-${index}`} className="relative overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
                        <div className="absolute left-0 top-0 h-1 w-full bg-[color:var(--surface-overlay)]" aria-hidden>
                          <div className="h-full bg-[color:var(--accent)]" style={{ width: `${clampPct(point.hit_rate_pct)}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{dateLabel(point.date)}</p>
                        <p className="mt-2 text-2xl font-bold tabular-nums text-[color:var(--success)]">{pct(point.hit_rate_pct)}</p>
                        <p className="mt-1 text-xs text-[color:var(--text-muted)]">{point.hits} hits · {point.misses} misses · N {point.resolved}</p>
                        <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-[color:var(--border-subtle)] pt-3 text-xs">
                          <div>
                            <dt className="text-[color:var(--text-muted)]">Brier</dt>
                            <dd className="mt-1 font-mono font-semibold text-[color:var(--text-primary)]">{score(point.mean_brier_score)}</dd>
                          </div>
                          <div>
                            <dt className="text-[color:var(--text-muted)]">Cal. gap</dt>
                            <dd className="mt-1 font-mono font-semibold text-[color:var(--text-primary)]">{probabilityPct(point.expected_calibration_error)}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface)] p-5 text-sm text-[color:var(--text-muted)]">
                  The timeline will start as soon as the first forecast horizon reaches its evaluation date.
                </div>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)]">
                <div className="border-b border-[color:var(--border-subtle)] px-4 py-3">
                  <h3 className="font-semibold text-[color:var(--text-primary)]">Accuracy by forecast horizon</h3>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">The exact seven future windows used on every report.</p>
                </div>
                <div className="grid gap-2 p-3 sm:hidden">
                  {JEV_HORIZON_ORDER.map((horizon) => {
                    const row = data.by_horizon.find((item) => item.horizon === horizon);
                    return (
                      <article key={horizon} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-[color:var(--text-primary)]">{HORIZON_LABELS[horizon]}</span>
                          <span className="text-lg font-bold tabular-nums text-[color:var(--success)]">{pct(row?.hit_rate_pct ?? null)}</span>
                        </div>
                        <p className="mt-2 text-xs text-[color:var(--text-muted)]">{row?.resolved ?? 0} resolved · Brier {score(row?.mean_brier_score ?? null)} · {row?.pending ?? 0} pending</p>
                      </article>
                    );
                  })}
                </div>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead className="text-xs uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
                      <tr>
                        <th className="px-4 py-3 text-left">Horizon</th>
                        <th className="px-3 py-3 text-right">Resolved</th>
                        <th className="px-3 py-3 text-right">Hit rate</th>
                        <th className="px-3 py-3 text-right">Brier</th>
                        <th className="px-4 py-3 text-right">Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {JEV_HORIZON_ORDER.map((horizon) => {
                        const row = data.by_horizon.find((item) => item.horizon === horizon);
                        return (
                          <tr key={horizon} className="border-t border-[color:var(--border-subtle)]">
                            <td className="px-4 py-3 font-semibold text-[color:var(--text-primary)]">{HORIZON_LABELS[horizon]}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-[color:var(--text-secondary)]">{row?.resolved ?? 0}</td>
                            <td className="px-3 py-3 text-right font-semibold tabular-nums text-[color:var(--success)]">{pct(row?.hit_rate_pct ?? null)}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-[color:var(--text-secondary)]">{score(row?.mean_brier_score ?? null)}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-[color:var(--text-muted)]">{row?.pending ?? 0}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
                <h3 className="font-semibold text-[color:var(--text-primary)]">Calibration map</h3>
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
                  Each row groups resolved forecasts by Jev&apos;s probability of a rise. “Average forecast” is the mean probability Jev assigned; “Actually rose” is the share of those stocks that went up. Closer values mean better calibration.
                </p>
                <div className="mt-4 space-y-4">
                  {data.calibration.map((bucket) => (
                    <div key={bucket.key}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-semibold text-[color:var(--text-secondary)]">{bucket.label}</span>
                        <span className="tabular-nums text-[color:var(--text-muted)]">
                          {bucket.count ? `${bucket.observed_up_count} of ${bucket.count} rose` : "No resolved forecasts"}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-[92px_1fr_44px] items-center gap-2 text-[11px]">
                        <span className="text-[color:var(--text-muted)]">Avg. forecast</span>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface)]">
                          <div className="h-full rounded-full bg-[color:var(--info)]" style={{ width: `${clampPct((bucket.mean_probability_up ?? 0) * 100)}%` }} />
                        </div>
                        <span className="text-right tabular-nums text-[color:var(--text-secondary)]">{probabilityPct(bucket.mean_probability_up)}</span>
                        <span className="text-[color:var(--text-muted)]">Actually rose</span>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--surface)]">
                          <div className="h-full rounded-full bg-[color:var(--success)]" style={{ width: `${clampPct((bucket.observed_up_rate ?? 0) * 100)}%` }} />
                        </div>
                        <span className="text-right tabular-nums text-[color:var(--text-secondary)]">{probabilityPct(bucket.observed_up_rate)}</span>
                      </div>
                      {bucket.absolute_gap !== null ? (
                        <p className="mt-1 text-right text-[10px] tabular-nums text-[color:var(--text-muted)]">
                          Gap {(bucket.absolute_gap * 100).toFixed(0)} percentage points
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-[color:var(--border-subtle)] pt-3 text-[11px] leading-relaxed text-[color:var(--text-muted)]">
                  Calibration error is the absolute gap in each populated row, weighted by its sample size. 0% is perfect; smaller is better.
                </p>
              </div>
            </div>

            <p className="text-right text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              Updated {new Date(data.generated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
