"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type SummaryWindow = "all" | "1y" | "3m" | "1m" | "1w";

type MeanRow = {
  key: string;
  label: string;
  mean_target_price: number | null;
  mean_allocation_pct: number | null;
  target_samples: number;
  allocation_samples: number;
};

type AssumptionRow = {
  key: string;
  label: string;
  mean_value: number | null;
  samples: number;
};

type SummaryPayload = {
  generated_at: string;
  ticker: string;
  window: SummaryWindow;
  coverage: {
    reports_total: number;
    reports_in_window: number;
    window: SummaryWindow;
  };
  overview: {
    live_current_price: number | null;
    mean_target_price: number | null;
    mean_allocation_pct: number | null;
    mean_disagreement_score: number | null;
    target_samples: number;
    allocation_samples: number;
    disagreement_samples: number;
  };
  by_model: MeanRow[];
  by_valuator: MeanRow[];
  assumptions: AssumptionRow[];
};

const WINDOW_OPTIONS: Array<{ key: SummaryWindow; label: string }> = [
  { key: "all", label: "All" },
  { key: "1y", label: "Last Year" },
  { key: "3m", label: "Last 3 Months" },
  { key: "1m", label: "Last Month" },
  { key: "1w", label: "Last Week" },
];

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

function fmtMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtNum(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toFixed(3);
}

function toneClassFromSign(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-zinc-100";
  if (Math.abs(value) <= 1e-9) return "text-zinc-200";
  return value > 0 ? "hib-target-up" : "hib-target-down";
}

function toneClassFromTarget(target: number | null | undefined, liveCurrent: number | null | undefined): string {
  if (typeof target !== "number" || !Number.isFinite(target)) return "text-zinc-100";
  if (typeof liveCurrent !== "number" || !Number.isFinite(liveCurrent)) return "text-zinc-100";
  if (Math.abs(target - liveCurrent) <= 1e-9) return "text-zinc-200";
  return target > liveCurrent ? "hib-target-up" : "hib-target-down";
}

function compareRowsByMeanTargetDesc(a: MeanRow, b: MeanRow): number {
  const av = typeof a.mean_target_price === "number" && Number.isFinite(a.mean_target_price) ? a.mean_target_price : Number.NEGATIVE_INFINITY;
  const bv = typeof b.mean_target_price === "number" && Number.isFinite(b.mean_target_price) ? b.mean_target_price : Number.NEGATIVE_INFINITY;
  if (bv !== av) return bv - av;
  return a.label.localeCompare(b.label);
}

function MeanTable({
  title,
  rows,
  liveCurrentPrice,
}: {
  title: string;
  rows: MeanRow[];
  liveCurrentPrice: number | null;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <article key={`${row.key}-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{row.label}</p>
            <p className={`mt-1 text-xl font-bold ${toneClassFromTarget(row.mean_target_price, liveCurrentPrice)}`}>
              {fmtMoney(row.mean_target_price)}
            </p>
            <p className={`mt-1 text-sm font-semibold ${toneClassFromSign(row.mean_allocation_pct)}`}>
              {fmtPct(row.mean_allocation_pct)}
            </p>
            <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
              <span>Target N {row.target_samples}</span>
              <span>Allocation N {row.allocation_samples}</span>
            </div>
          </article>
        ))}
        {!rows.length ? <p className="text-sm text-zinc-500">No rows available.</p> : null}
      </div>
      <div className="overflow-auto rounded-xl border border-white/10 bg-black/25">
        <table className="hidden w-full min-w-[760px] text-sm sm:table">
          <thead className="border-b border-white/10 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Mean Target</th>
              <th className="px-3 py-2 text-right font-medium">Target N</th>
              <th className="px-3 py-2 text-right font-medium">Mean Allocation</th>
              <th className="px-3 py-2 text-right font-medium">Allocation N</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-white/5 last:border-b-0">
                <td className="px-3 py-2 font-medium text-zinc-200">{row.label}</td>
                <td className={`px-3 py-2 text-right ${toneClassFromTarget(row.mean_target_price, liveCurrentPrice)}`}>
                  {fmtMoney(row.mean_target_price)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">{row.target_samples}</td>
                <td className={`px-3 py-2 text-right ${toneClassFromSign(row.mean_allocation_pct)}`}>
                  {fmtPct(row.mean_allocation_pct)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">{row.allocation_samples}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-zinc-500">
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

function AssumptionsTable({ rows }: { rows: AssumptionRow[] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.16em] text-zinc-300">Assumptions Mean Values</h2>
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <article key={`${row.key}-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{row.label}</p>
            <p className="mt-1 text-lg font-bold text-zinc-100">{fmtNum(row.mean_value)}</p>
            <p className="mt-1 text-xs text-zinc-400">N {row.samples}</p>
          </article>
        ))}
        {!rows.length ? <p className="text-sm text-zinc-500">No assumptions available.</p> : null}
      </div>
      <div className="overflow-auto rounded-xl border border-white/10 bg-black/25">
        <table className="hidden w-full min-w-[560px] text-sm sm:table">
          <thead className="border-b border-white/10 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Assumption</th>
              <th className="px-3 py-2 text-right font-medium">Mean</th>
              <th className="px-3 py-2 text-right font-medium">N</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-white/5 last:border-b-0">
                <td className="px-3 py-2 font-medium text-zinc-200">{row.label}</td>
                <td className="px-3 py-2 text-right text-zinc-100">{fmtNum(row.mean_value)}</td>
                <td className="px-3 py-2 text-right text-zinc-400">{row.samples}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-zinc-500">
                  No assumptions available.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DashboardSummaryPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const search = useSearchParams();
  const upper = decodeURIComponent(String(ticker || "")).toUpperCase();
  const [windowKey, setWindowKey] = useState<SummaryWindow>("all");
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [data, setData] = useState<SummaryPayload | null>(null);

  const reportId = search?.get("report") || "";

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/dashboard/${encodeURIComponent(upper)}/summary?window=${encodeURIComponent(windowKey)}&refresh=${Date.now()}-${refreshToken}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as SummaryPayload;
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
  }, [upper, windowKey, refreshToken]);

  const coverageText = useMemo(() => {
    if (!data) return "";
    return `Using ${data.coverage.reports_in_window} reports (out of ${data.coverage.reports_total}) for ${upper}.`;
  }, [data, upper]);

  const meanTargetChangePct =
    typeof data?.overview?.mean_target_price === "number" &&
    Number.isFinite(data.overview.mean_target_price) &&
    typeof data?.overview?.live_current_price === "number" &&
    Number.isFinite(data.overview.live_current_price) &&
    Math.abs(data.overview.live_current_price) > 1e-9
      ? ((data.overview.mean_target_price - data.overview.live_current_price) / data.overview.live_current_price) * 100
      : null;
  const modelRowsSorted = useMemo(
    () => (data?.by_model || []).slice().sort(compareRowsByMeanTargetDesc),
    [data?.by_model],
  );
  const valuatorRowsSorted = useMemo(
    () => (data?.by_valuator || []).slice().sort(compareRowsByMeanTargetDesc),
    [data?.by_valuator],
  );

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-zinc-100">Overall Summary</h1>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              {upper} · Aggregated across report history
            </p>
            {reportId ? (
              <p className="mt-1 text-xs text-zinc-500">Current report selection is ignored here; this view always uses history.</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setWindowKey(opt.key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    windowKey === opt.key
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "text-zinc-300 hover:text-zinc-100"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRefreshToken((v) => v + 1)}
              disabled={loading}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-200 transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      {loading || !data ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-28 animate-pulse rounded-xl border border-white/10 bg-white/5" />
          ))}
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-400">
            {coverageText} Generated at {fmtDateTimeNoSeconds(data.generated_at)}.
          </p>

          <section className="grid gap-4 md:grid-cols-4">
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Current Live Price</p>
              <p className="mt-2 text-3xl font-bold text-zinc-100">{fmtMoney(data.overview.live_current_price)}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mean Target</p>
              <p className={`mt-2 text-3xl font-bold ${toneClassFromTarget(data.overview.mean_target_price, data.overview.live_current_price)}`}>
                {fmtMoney(data.overview.mean_target_price)}{" "}
                <span className="text-lg">({fmtPct(meanTargetChangePct)})</span>
              </p>
              <p className="mt-2 text-xs text-zinc-400">N {data.overview.target_samples}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mean Allocation</p>
              <p className={`mt-2 text-3xl font-bold ${toneClassFromSign(data.overview.mean_allocation_pct)}`}>
                {fmtPct(data.overview.mean_allocation_pct)}
              </p>
              <p className="mt-2 text-xs text-zinc-400">N {data.overview.allocation_samples}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mean Disagreement Score</p>
              <p className="mt-2 text-3xl font-bold text-zinc-100">{fmtNum(data.overview.mean_disagreement_score)}</p>
              <p className="mt-2 text-xs text-zinc-400">N {data.overview.disagreement_samples}</p>
            </article>
          </section>

          <MeanTable
            title="By Model Mean Target + Mean Allocation"
            rows={modelRowsSorted}
            liveCurrentPrice={data.overview.live_current_price}
          />
          <MeanTable
            title="By Valuator Mean Target + Mean Allocation"
            rows={valuatorRowsSorted}
            liveCurrentPrice={data.overview.live_current_price}
          />
          <AssumptionsTable rows={data.assumptions} />
        </>
      )}
    </div>
  );
}
