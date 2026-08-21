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
  return `H ${metric.hits} | M ${metric.misses} | - ${metric.neutral} | N ${metric.considered}`;
}

function CountBadge({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 tabular-nums">
      <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">{label}</span>
      <span className="font-mono text-[11px] font-semibold text-zinc-200">{value}</span>
    </span>
  );
}

function CountsPills({ metric }: { metric: MetricCounts }) {
  return (
    <div className="inline-flex flex-nowrap items-center justify-end gap-1 whitespace-nowrap">
      <CountBadge label="H" value={metric.hits} />
      <CountBadge label="M" value={metric.misses} />
      <CountBadge label="-" value={metric.neutral} />
      <CountBadge label="N" value={metric.considered} />
    </div>
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
    <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-zinc-100">{fmtHitRate(metric.hit_rate_pct)}</p>
      <p className="mt-2 text-xs text-zinc-400">{metricSummary(metric)}</p>
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
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <article key={`${row.key}-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
            {discoveryHrefForRow(row) ? (
              <Link
                href={discoveryHrefForRow(row) || "#"}
                className="hib-hitrate-link text-[11px] uppercase tracking-[0.12em] underline-offset-2 hover:underline"
              >
                {row.label}
              </Link>
            ) : (
              <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-300">{row.label}</span>
            )}
            <p className="mt-1 text-xl font-bold text-zinc-100">Combined {fmtHitRate(row.combined.hit_rate_pct)}</p>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-zinc-300">Targets {fmtHitRate(row.targets.hit_rate_pct)}</span>
              <span className="text-zinc-300">Alloc {fmtHitRate(row.allocations.hit_rate_pct)}</span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px]">
              <CountsPills metric={row.combined} />
            </div>
          </article>
        ))}
        {!rows.length ? <p className="text-sm text-zinc-500">No rows available.</p> : null}
      </div>
      <div className="overflow-auto rounded-xl border border-white/10 bg-black/25">
        <table className="hidden w-full min-w-[1080px] text-sm sm:table">
          <thead className="border-b border-white/10 text-zinc-400">
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
              <tr key={row.key} className="border-b border-white/5 last:border-b-0">
                <td className="px-3 py-2 font-medium text-zinc-200">
                  {discoveryHrefForRow(row) ? (
                    <Link
                      href={discoveryHrefForRow(row) || "#"}
                      className="hib-hitrate-link underline-offset-2 hover:underline"
                    >
                      {row.label}
                    </Link>
                  ) : (
                    <span>{row.label}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-zinc-100">{fmtHitRate(row.targets.hit_rate_pct)}</td>
                <td className="px-3 py-2 text-right text-zinc-100">{fmtHitRate(row.allocations.hit_rate_pct)}</td>
                <td className="px-3 py-2 text-right font-semibold text-zinc-100">{fmtHitRate(row.combined.hit_rate_pct)}</td>
                <td className="px-3 py-2 text-right text-zinc-400">
                  <CountsPills metric={row.targets} />
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">
                  <CountsPills metric={row.allocations} />
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">
                  <CountsPills metric={row.combined} />
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-zinc-500">
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
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <article key={`${row.key}-signal-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
            <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-300">{row.label}</span>
            <p className="mt-1 text-xl font-bold text-zinc-100">Signal {fmtHitRate(row.signals.hit_rate_pct)}</p>
            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px]">
              <CountsPills metric={row.signals} />
            </div>
          </article>
        ))}
        {!rows.length ? <p className="text-sm text-zinc-500">No signal rows available.</p> : null}
      </div>
      <div className="overflow-auto rounded-xl border border-white/10 bg-black/25">
        <table className="hidden w-full min-w-[520px] text-sm sm:table">
          <thead className="border-b border-white/10 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Signal %</th>
              <th className="px-3 py-2 text-right font-medium">Signal Counts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-white/5 last:border-b-0">
                <td className="px-3 py-2 font-medium text-zinc-200">{row.label}</td>
                <td className="px-3 py-2 text-right font-semibold text-zinc-100">{fmtHitRate(row.signals.hit_rate_pct)}</td>
                <td className="px-3 py-2 text-right text-zinc-400">
                  <CountsPills metric={row.signals} />
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-zinc-500">
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
            <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => setMode("all")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                  mode === "all"
                    ? "bg-emerald-500/20 text-emerald-100"
                    : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setMode("positive_only")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                  mode === "positive_only"
                    ? "bg-emerald-500/20 text-emerald-100"
                    : "text-zinc-300 hover:text-zinc-100"
                }`}
              >
                Positive Only
              </button>
            </div>
            <button
              type="button"
              onClick={() => setRefreshToken((v) => v + 1)}
              disabled={loading}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-200 transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
            >
              {loading ? "Refreshing..." : "Refresh Hit Rate"}
            </button>
          </div>
        </div>
      </section>

      {loading || !data ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/5" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
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
