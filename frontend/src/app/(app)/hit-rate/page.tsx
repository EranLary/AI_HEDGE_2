"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PortfolioReturnsSection } from "@/components/portfolio-returns-section";
import { useWorkspace } from "@/components/shell/workspace-context";
import { WORKSPACE_CONFIG } from "@/lib/workspace";

type MetricCounts = {
  hits: number;
  misses: number;
  neutral: number;
  considered: number;
  hit_rate_pct: number | null;
};

type MetricCountsSet = {
  targets: MetricCounts;
  allocations: MetricCounts;
  signals: MetricCounts;
  combined: MetricCounts;
};

type HitRateRow = {
  key: string;
  label: string;
  targets: MetricCounts;
  allocations: MetricCounts;
  signals: MetricCounts;
  combined: MetricCounts;
};

type HitRatePayload = {
  generated_at: string;
  mode?: "all" | "positive_only";
  coverage: {
    reports_scanned: number;
    reports_with_baseline_price: number;
    tickers_covered: number;
    tickers_with_live_price: number;
    predictions_total: number;
    predictions_considered: number;
    predictions_neutral: number;
  };
  overview: MetricCountsSet;
  by_model: HitRateRow[];
  by_valuator: HitRateRow[];
  by_signal: HitRateRow[];
};

type HitRateMode = "all" | "positive_only";

function fmtDateTimeNoSeconds(value: string): string {
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "N/A";
  return dt.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtHitRate(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function metricSummary(metric: MetricCounts): string {
  return `${metric.hits} hits, ${metric.misses} misses, ${metric.neutral} neutral, ${metric.considered} evaluated`;
}

function CountBadge({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-1.5 py-0.5 tabular-nums">
      <span className="text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-muted)]">{label}</span>
      <span className="font-mono text-[11px] font-semibold text-[color:var(--text-primary)]">{value}</span>
    </span>
  );
}

function CountsPills({ metric }: { metric: MetricCounts }) {
  return (
    <div className="inline-flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
      <CountBadge label="Hit" value={metric.hits} />
      <CountBadge label="Miss" value={metric.misses} />
      <CountBadge label="Neut" value={metric.neutral} />
      <CountBadge label="Eval" value={metric.considered} />
    </div>
  );
}

function RateBreakdown({
  label,
  metric,
}: {
  label: string;
  metric: MetricCounts;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">{label}</p>
        <p className="text-lg font-bold tabular-nums text-[color:var(--success)]">{fmtHitRate(metric.hit_rate_pct)}</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[color:var(--text-muted)]">Hits</dt>
          <dd className="font-semibold tabular-nums text-[color:var(--text-primary)]">{metric.hits}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[color:var(--text-muted)]">Misses</dt>
          <dd className="font-semibold tabular-nums text-[color:var(--text-primary)]">{metric.misses}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[color:var(--text-muted)]">Evaluated</dt>
          <dd className="font-semibold tabular-nums text-[color:var(--text-primary)]">{metric.considered}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[color:var(--text-muted)]">Neutral</dt>
          <dd className="font-semibold tabular-nums text-[color:var(--text-primary)]">{metric.neutral}</dd>
        </div>
      </dl>
    </div>
  );
}

function MobileCounts({ metric }: { metric: MetricCounts }) {
  const counts = [
    ["Hits", metric.hits],
    ["Misses", metric.misses],
    ["Evaluated", metric.considered],
    ["Neutral", metric.neutral],
  ] as const;

  return (
    <dl className="mt-3 grid grid-cols-2 gap-2">
      {counts.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] px-3 py-2 text-xs">
          <dt className="text-[color:var(--text-muted)]">{label}</dt>
          <dd className="font-semibold tabular-nums text-[color:var(--text-primary)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OverviewCard({
  title,
  metric,
}: {
  title: string;
  metric: MetricCounts;
}) {
  return (
    <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-secondary)]">{title}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-[color:var(--success)]">{fmtHitRate(metric.hit_rate_pct)}</p>
      <p className="mt-2 text-xs leading-relaxed text-[color:var(--text-muted)]">{metricSummary(metric)}</p>
    </article>
  );
}

function HitRateTable({
  title,
  rows,
  lensType,
}: {
  title: string;
  rows: HitRateRow[];
  lensType: "model" | "valuator";
}) {
  const { href } = useWorkspace();
  const discoveryHrefForRow = (row: HitRateRow): string | null => {
    if (lensType === "model") {
      if (String(row.key || "").trim().toLowerCase() === "overall") {
        return href("/discovery?lens_type=overall");
      }
      return href(`/discovery?lens_type=model&lens_key=${encodeURIComponent(String(row.label || "").trim())}`);
    }
    return href(`/discovery?lens_type=valuator&lens_key=${encodeURIComponent(String(row.label || "").trim())}`);
  };

  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">{title}</h3>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <article key={`${row.key}-mobile`} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {discoveryHrefForRow(row) ? (
                  <Link
                    href={discoveryHrefForRow(row) || "#"}
                    className="text-base font-bold leading-tight text-[color:var(--accent)] underline-offset-2 hover:text-[color:var(--accent-hover)] hover:underline"
                  >
                    {row.label}
                  </Link>
                ) : (
                  <span className="text-base font-bold leading-tight text-[color:var(--text-primary)]">{row.label}</span>
                )}
                <p className="mt-1 text-xs leading-relaxed text-[color:var(--text-muted)]">
                  {row.combined.hits} hits from {row.combined.considered} evaluated
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Combined</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-[color:var(--success)]">{fmtHitRate(row.combined.hit_rate_pct)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <RateBreakdown label="Targets" metric={row.targets} />
              <RateBreakdown label="Allocations" metric={row.allocations} />
            </div>
          </article>
        ))}
        {!rows.length ? <p className="text-sm text-[color:var(--text-muted)]">No rows available.</p> : null}
      </div>
      <div className="hidden overflow-auto rounded-lg border border-[color:var(--border-subtle)] md:block">
        <table className="w-full min-w-[1260px] text-sm">
          <thead className="border-b border-[color:var(--border-subtle)] bg-[color:var(--surface)] text-[color:var(--text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Targets %</th>
              <th className="px-3 py-2 text-right font-medium">Allocations %</th>
              <th className="px-3 py-2 text-right font-medium">Combined %</th>
              <th className="px-3 py-2 text-right font-medium">Targets Counts</th>
              <th className="px-3 py-2 text-right font-medium">Allocations Counts</th>
              <th className="px-3 py-2 text-right font-medium">Combined Counts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-[color:var(--border-subtle)] last:border-b-0">
                <td className="px-3 py-2 font-semibold text-[color:var(--text-primary)]">
                  {discoveryHrefForRow(row) ? (
                    <Link
                      href={discoveryHrefForRow(row) || "#"}
                      className="font-semibold text-[color:var(--accent)] underline-offset-2 hover:text-[color:var(--accent-hover)] hover:underline"
                    >
                      {row.label}
                    </Link>
                  ) : (
                    <span>{row.label}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{fmtHitRate(row.targets.hit_rate_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{fmtHitRate(row.allocations.hit_rate_pct)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-[color:var(--success)]">{fmtHitRate(row.combined.hit_rate_pct)}</td>
                <td className="px-3 py-2 text-right text-[color:var(--text-muted)]">
                  <CountsPills metric={row.targets} />
                </td>
                <td className="px-3 py-2 text-right text-[color:var(--text-muted)]">
                  <CountsPills metric={row.allocations} />
                </td>
                <td className="px-3 py-2 text-right text-[color:var(--text-muted)]">
                  <CountsPills metric={row.combined} />
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-[color:var(--text-muted)]">
                  No rows available.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SignalHitRateTable({
  title,
  rows,
}: {
  title: string;
  rows: HitRateRow[];
}) {
  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">{title}</h3>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <article key={`${row.key}-signal-mobile`} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
            <div className="flex items-start justify-between gap-3">
              <span className="text-base font-bold leading-tight text-[color:var(--text-primary)]">{row.label}</span>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Signal hit rate</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-[color:var(--success)]">{fmtHitRate(row.signals.hit_rate_pct)}</p>
              </div>
            </div>
            <MobileCounts metric={row.signals} />
          </article>
        ))}
        {!rows.length ? <p className="text-sm text-[color:var(--text-muted)]">No signal rows available.</p> : null}
      </div>
      <div className="hidden overflow-auto rounded-lg border border-[color:var(--border-subtle)] md:block">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="border-b border-[color:var(--border-subtle)] bg-[color:var(--surface)] text-[color:var(--text-muted)]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Signal %</th>
              <th className="px-3 py-2 text-right font-medium">Signal Counts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-[color:var(--border-subtle)] last:border-b-0">
                <td className="px-3 py-2 font-semibold text-[color:var(--text-primary)]">{row.label}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-[color:var(--success)]">{fmtHitRate(row.signals.hit_rate_pct)}</td>
                <td className="px-3 py-2 text-right text-[color:var(--text-muted)]">
                  <CountsPills metric={row.signals} />
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-[color:var(--text-muted)]">
                  No signal rows available.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function HitRatePage() {
  const { workspace, api } = useWorkspace();
  const workspaceConfig = WORKSPACE_CONFIG[workspace];
  const [data, setData] = useState<HitRatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [mode, setMode] = useState<HitRateMode>("positive_only");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(api(`/api/hit-rate?mode=${mode}&refresh=${Date.now()}-${refreshToken}`), { cache: "no-store" });
        const json = (await res.json()) as HitRatePayload;
        if (!cancelled) {
          setData(json);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [api, refreshToken, mode, workspace]);

  const coverageText = useMemo(() => {
    if (!data) return "";
    const modeLabel =
      mode === "positive_only"
        ? "Positive-only valuation mode; technical signals include bullish and bearish calls"
        : "All predictions mode";
    return `${modeLabel}. Scanned ${data.coverage.reports_scanned} reports across ${data.coverage.tickers_covered} tickers. Considered ${data.coverage.predictions_considered} predictions (${data.coverage.predictions_neutral} neutral).`;
  }, [data, mode]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 text-[color:var(--text-primary)] sm:px-8">
      <header className="mb-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Measurement</p>
        <h1 className="mt-1 font-display text-2xl">Our Track Record</h1>
        <p className="mt-1 max-w-3xl text-sm text-[color:var(--text-muted)]">
          Two simple views of how our analysis performs over time.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
            <h2 className="font-semibold text-[color:var(--text-primary)]">Portfolio Returns</h2>
            <p className="mt-1 text-sm leading-relaxed text-[color:var(--text-muted)]">
              Shows what happened to each monthly Top 20 portfolio, compared with {workspaceConfig.benchmarkName}.
            </p>
          </article>
          <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
            <h2 className="font-semibold text-[color:var(--text-primary)]">Hit Rate</h2>
            <p className="mt-1 text-sm leading-relaxed text-[color:var(--text-muted)]">
              Shows how often our targets, allocations, and signals pointed in the right direction after each report.
            </p>
          </article>
        </div>
      </header>

      <PortfolioReturnsSection />

      <section className="mb-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-[color:var(--text-primary)]">Hit Rate</h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">Accuracy across all historical reports.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-1" aria-label="Hit rate mode">
              <button
                type="button"
                onClick={() => setMode("all")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                  mode === "all"
                    ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                    : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setMode("positive_only")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                  mode === "positive_only"
                    ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                    : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                Positive Only
              </button>
            </div>
            <button
              type="button"
              onClick={() => setRefreshToken((v) => v + 1)}
              disabled={loading}
              className="rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-secondary)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)]"
            >
              {loading ? "Refreshing..." : "Refresh Hit Rate"}
            </button>
          </div>
        </div>
      </section>

      {loading || !data ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-32 animate-pulse rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)]" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--text-muted)]">
            {coverageText} Generated at {fmtDateTimeNoSeconds(data.generated_at)}.
          </p>

          <section className="grid gap-4 md:grid-cols-4">
            <OverviewCard title="Targets" metric={data.overview.targets} />
            <OverviewCard title="Allocations" metric={data.overview.allocations} />
            <OverviewCard title="Signals" metric={data.overview.signals} />
            <OverviewCard title="Combined" metric={data.overview.combined} />
          </section>

          <HitRateTable title="By Model" rows={data.by_model} lensType="model" />
          <HitRateTable title="By Valuator" rows={data.by_valuator} lensType="valuator" />
          <SignalHitRateTable title="By Signal" rows={data.by_signal || []} />
        </div>
      )}
    </div>
  );
}
