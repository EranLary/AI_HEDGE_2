"use client";

import { useEffect, useMemo, useState } from "react";

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
  combined: MetricCounts;
};

type HitRateRow = {
  key: string;
  label: string;
  targets: MetricCounts;
  allocations: MetricCounts;
  combined: MetricCounts;
};

type HitRatePayload = {
  generated_at: string;
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
};

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
    <span className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">{label}</span>
      <span className="font-mono text-[11px] font-semibold text-zinc-200">{value}</span>
    </span>
  );
}

function CountsPills({ metric }: { metric: MetricCounts }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
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
}: {
  title: string;
  rows: HitRateRow[];
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
      <div className="overflow-auto rounded-xl border border-white/10 bg-black/25">
        <table className="w-full min-w-[1080px] text-sm">
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
                <td className="px-3 py-2 font-medium text-zinc-200">{row.label}</td>
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

export default function HitRatePage() {
  const [data, setData] = useState<HitRatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(`/api/hit-rate?refresh=${Date.now()}-${refreshToken}`, { cache: "no-store" });
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
  }, [refreshToken]);

  const coverageText = useMemo(() => {
    if (!data) return "";
    return `Scanned ${data.coverage.reports_scanned} reports across ${data.coverage.tickers_covered} tickers. Considered ${data.coverage.predictions_considered} predictions (${data.coverage.predictions_neutral} neutral).`;
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 text-zinc-100 sm:px-8">
      <header className="mb-6 rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl">Hit Rate</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Global Accuracy Across All Historical Reports</p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshToken((v) => v + 1)}
            disabled={loading}
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-200 transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Refreshing..." : "Refresh Hit Rate"}
          </button>
        </div>
      </header>

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

          <section className="grid gap-4 md:grid-cols-3">
            <OverviewCard title="Targets" metric={data.overview.targets} />
            <OverviewCard title="Allocations" metric={data.overview.allocations} />
            <OverviewCard title="Combined" metric={data.overview.combined} />
          </section>

          <HitRateTable title="By Model" rows={data.by_model} />
          <HitRateTable title="By Valuator" rows={data.by_valuator} />
        </div>
      )}
    </div>
  );
}

