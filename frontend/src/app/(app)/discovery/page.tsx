"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Gem, Radar, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DiscoveryRow } from "@/lib/dashboard-types";

type DiscoveryLensType = "overall" | "model" | "valuator";
type PerformanceWindowKey = "1w" | "1m" | "1y" | "all";

type DiscoveryPayload = {
  generated_at: string;
  lens: {
    type: DiscoveryLensType;
    key: string | null;
    label: string;
  };
  lens_options: {
    models: string[];
    valuators: string[];
  };
  window_hours: number | null;
  count: number;
  top_undervalued: DiscoveryRow[];
  top_overvalued: DiscoveryRow[];
  top_conviction: DiscoveryRow[];
  top_highest_allocation: DiscoveryRow[];
  top_lowest_allocation: DiscoveryRow[];
};

type DiscoveryPerformancePoint = {
  date: string;
  nav: number;
  cumulative_return_pct: number;
};

type DiscoveryPerformanceSeries = {
  key: string;
  label: string;
  points: DiscoveryPerformancePoint[];
  latest_stats: {
    nav: number | null;
    cumulative_return_pct: number | null;
    daily_return_pct: number | null;
    max_drawdown_pct: number | null;
  };
};

type DiscoveryPerformancePayload = {
  generated_at: string;
  trade_date: string | null;
  lens: {
    type: DiscoveryLensType;
    key: string | null;
    label: string;
  };
  series: DiscoveryPerformanceSeries[];
  windows: Record<string, { key: string; label: string; start_date: string | null }>;
};

type ChartRow = {
  date: string;
  [key: string]: number | string | null;
};

async function readJsonOrThrow<T>(res: Response, label: string): Promise<T> {
  const raw = await res.text();
  if (!res.ok) {
    const details = raw.trim() ? `: ${raw.slice(0, 240)}` : "";
    throw new Error(`${label} failed (${res.status})${details}`);
  }
  if (!raw.trim()) {
    throw new Error(`${label} returned an empty response body`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

const LINE_COLORS: Record<string, string> = {
  most_undervalued_top10: "#2563eb",
  most_undervalued_top20: "#7c3aed",
  highest_allocation_top10: "#0ea5e9",
  highest_allocation_top20: "#f97316",
  benchmark_sp500: "#facc15",
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

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function returnToneClass(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-zinc-300";
  if (Math.abs(value) < 1e-9) return "text-zinc-200";
  return value > 0 ? "text-emerald-300" : "text-red-300";
}

function decisionClass(tone?: DiscoveryRow["decision_tone"]): string {
  if (tone === "buy") return "hib-signal-buy";
  if (tone === "sell") return "hib-signal-sell";
  return "hib-signal-hold";
}

function buildWindowSeries(
  series: DiscoveryPerformanceSeries[],
  startDate: string | null,
): DiscoveryPerformanceSeries[] {
  return series.map((line) => {
    const sliced = startDate
      ? line.points.filter((point) => point.date >= startDate)
      : line.points.slice();
    if (!sliced.length) {
      return {
        ...line,
        points: [],
        latest_stats: {
          nav: null,
          cumulative_return_pct: null,
          daily_return_pct: line.latest_stats.daily_return_pct,
          max_drawdown_pct: null,
        },
      };
    }
    const baseline = sliced[0].nav;
    const points = sliced.map((point) => ({
      ...point,
      cumulative_return_pct: baseline > 0 ? ((point.nav / baseline) - 1) * 100 : 0,
    }));
    const last = points[points.length - 1];
    return {
      ...line,
      points,
      latest_stats: {
        ...line.latest_stats,
        nav: last.nav,
        cumulative_return_pct: last.cumulative_return_pct,
      },
    };
  });
}

function buildChartRows(series: DiscoveryPerformanceSeries[]): ChartRow[] {
  const allDates = new Set<string>();
  for (const line of series) {
    for (const point of line.points) {
      allDates.add(point.date);
    }
  }
  const dates = Array.from(allDates).sort((a, b) => a.localeCompare(b));
  return dates.map((date) => {
    const row: ChartRow = { date };
    for (const line of series) {
      const point = line.points.find((p) => p.date === date) || null;
      row[line.key] = point ? point.cumulative_return_pct : null;
    }
    return row;
  });
}

function SectionCard({
  title,
  icon,
  rows,
  accent,
  metricLabel,
}: {
  title: string;
  icon: ReactNode;
  rows: DiscoveryRow[];
  accent: string;
  metricLabel: "return" | "disagreement" | "allocation";
}) {
  const [topN, setTopN] = useState<10 | 20>(10);
  const shownRows = rows.slice(0, topN);
  const canShow20 = rows.length > 10;

  return (
    <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
        </div>
        {canShow20 ? (
          <div className="inline-flex rounded-md border border-white/15 bg-white/5 p-0.5 text-[10px] uppercase tracking-[0.12em]">
            <button
              type="button"
              onClick={() => setTopN(10)}
              className={`rounded px-2 py-1 transition ${topN === 10 ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"}`}
            >
              Top 10
            </button>
            <button
              type="button"
              onClick={() => setTopN(20)}
              className={`rounded px-2 py-1 transition ${topN === 20 ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"}`}
            >
              Top 20
            </button>
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        {shownRows.length ? (
          shownRows.map((row, idx) => (
            <div key={`${title}-${row.ticker}-${row.updated_at}-${idx}`} className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">#{idx + 1} {row.ticker}</p>
                  <p className="text-xs text-zinc-500">{row.company_name}</p>
                </div>
                <Link
                  href={`/dashboard/${encodeURIComponent(row.ticker)}/summary`}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-zinc-200 transition hover:border-emerald-300/60 hover:bg-emerald-500/10"
                >
                  Open
                </Link>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {metricLabel === "return" ? (
                  <div>
                    <p className="text-zinc-500">Return</p>
                    <p className={accent}>{fmtPct(row.return_pct)}</p>
                  </div>
                ) : metricLabel === "allocation" ? (
                  <div>
                    <p className="text-zinc-500">Allocation</p>
                    <p className={accent}>
                      {typeof row.investment_allocation_pct === "number" && Number.isFinite(row.investment_allocation_pct)
                        ? fmtPct(row.investment_allocation_pct)
                        : "N/A"}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-zinc-500">Disagreement Score</p>
                    <p className={accent}>{Number.isFinite(row.confidence_cv) ? row.confidence_cv.toFixed(3) : "N/A"}</p>
                    <p className={`mt-1 font-semibold ${decisionClass(row.decision_tone)}`}>
                      {row.decision_label || "Hold"}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-zinc-500">Updated</p>
                  <p className="text-zinc-200">{fmtDateTimeNoSeconds(String(row.updated_at || ""))}</p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No rows available.</p>
        )}
      </div>
    </article>
  );
}

export default function DiscoveryPage() {
  const [data, setData] = useState<DiscoveryPayload | null>(null);
  const [performance, setPerformance] = useState<DiscoveryPerformancePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lensType, setLensType] = useState<DiscoveryLensType>("overall");
  const [lensKey, setLensKey] = useState("");
  const [windowKey, setWindowKey] = useState<PerformanceWindowKey>("1m");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        params.set("lens_type", lensType);
        if (lensType !== "overall" && lensKey.trim()) {
          params.set("lens_key", lensKey.trim());
        }
        const [discoveryRes, performanceRes] = await Promise.all([
          fetch(`/api/discovery?${params.toString()}`, { cache: "no-store" }),
          fetch(`/api/discovery/performance?${params.toString()}`, { cache: "no-store" }),
        ]);
        const discoveryJson = await readJsonOrThrow<DiscoveryPayload>(discoveryRes, "Discovery API");
        const performanceJson = await readJsonOrThrow<DiscoveryPerformancePayload>(performanceRes, "Discovery performance API");
        if (!cancelled) {
          setData(discoveryJson);
          setPerformance(performanceJson);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed loading discovery data");
          setPerformance(null);
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
  }, [lensType, lensKey]);

  const modelOptions = data?.lens_options.models || [];
  const valuatorOptions = data?.lens_options.valuators || [];
  const selectedOptions = lensType === "model" ? modelOptions : lensType === "valuator" ? valuatorOptions : [];

  const onLensTypeChange = (next: DiscoveryLensType) => {
    setLensType(next);
    if (next === "overall") {
      setLensKey("");
      return;
    }
    const pool = next === "model" ? modelOptions : valuatorOptions;
    setLensKey(pool[0] || "");
  };

  const chartWindowStart = useMemo(() => {
    if (!performance) return null;
    return performance.windows?.[windowKey]?.start_date || null;
  }, [performance, windowKey]);

  const windowedSeries = useMemo(
    () => buildWindowSeries(performance?.series || [], chartWindowStart),
    [performance, chartWindowStart],
  );

  const chartRows = useMemo(() => buildChartRows(windowedSeries), [windowedSeries]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 text-zinc-100 sm:px-8">
      <div>
        <header className="mb-6 rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
          <h1 className="font-display text-2xl">Market Discovery</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">All Reports (Latest Per Ticker)</p>
        </header>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-40 animate-pulse rounded-xl border border-white/10 bg-white/5" />
            ))}
          </div>
        ) : !data ? (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {loadError || "Failed to load discovery data."}
          </div>
        ) : (
          <>
            {loadError ? (
              <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                {loadError}
              </div>
            ) : null}
            <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Discovery Lens</p>
                  <p className="text-sm font-semibold text-zinc-100">{data.lens.label}</p>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <div className="inline-flex rounded-xl border border-white/15 bg-white/5 p-1 text-xs uppercase tracking-[0.12em]">
                    <button
                      type="button"
                      onClick={() => onLensTypeChange("overall")}
                      className={`rounded-lg px-3 py-1.5 transition ${
                        lensType === "overall" ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"
                      }`}
                    >
                      Overall
                    </button>
                    <button
                      type="button"
                      onClick={() => onLensTypeChange("model")}
                      className={`rounded-lg px-3 py-1.5 transition ${
                        lensType === "model" ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                      disabled={!modelOptions.length}
                    >
                      Model
                    </button>
                    <button
                      type="button"
                      onClick={() => onLensTypeChange("valuator")}
                      className={`rounded-lg px-3 py-1.5 transition ${
                        lensType === "valuator" ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                      disabled={!valuatorOptions.length}
                    >
                      Valuator
                    </button>
                  </div>
                  {lensType !== "overall" ? (
                    <select
                      value={lensKey}
                      onChange={(e) => setLensKey(String(e.target.value || ""))}
                      className="w-full min-w-[260px] rounded-lg border border-white/15 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/60 sm:w-auto"
                    >
                      {selectedOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>
            </section>
            <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Strategy Equity Curves</p>
                  <p className="text-sm text-zinc-300">Dynamic daily-rebalanced forward test vs S&P 500.</p>
                </div>
                <div className="inline-flex rounded-xl border border-white/15 bg-white/5 p-1 text-xs uppercase tracking-[0.12em]">
                  {(["1w", "1m", "1y", "all"] as PerformanceWindowKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setWindowKey(key)}
                      className={`rounded-lg px-3 py-1.5 transition ${
                        windowKey === key ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"
                      }`}
                    >
                      {performance?.windows?.[key]?.label || key.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {chartRows.length ? (
                <>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartRows} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={28} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} width={56} />
                        <Tooltip
                          formatter={(value) => `${Number(value ?? 0).toFixed(2)}%`}
                          labelFormatter={(value) => String(value)}
                        />
                        {windowedSeries.map((line) => (
                          <Line
                            key={line.key}
                            type="monotone"
                            dataKey={line.key}
                            stroke={LINE_COLORS[line.key] || "#a1a1aa"}
                            strokeWidth={line.key === "benchmark_sp500" ? 2.5 : 2}
                            dot={false}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {windowedSeries.map((line) => (
                      <div key={`stat-${line.key}`} className="rounded-lg border border-white/10 bg-black/25 p-2 text-xs">
                        <p className="flex items-center gap-1.5 text-zinc-400">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: LINE_COLORS[line.key] || "#a1a1aa" }}
                            aria-hidden
                          />
                          <span>{line.label}</span>
                        </p>
                        <p className={`mt-1 font-semibold ${returnToneClass(line.latest_stats.cumulative_return_pct)}`}>
                          {typeof line.latest_stats.cumulative_return_pct === "number"
                            ? fmtPct(line.latest_stats.cumulative_return_pct)
                            : "N/A"}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-500">Performance history is not available yet. It will start at feature go-live.</p>
              )}
            </section>
            <p className="mb-4 text-sm text-zinc-400">
              Scanned {data.count} tickers for this lens. Generated at {fmtDateTimeNoSeconds(String(data.generated_at || ""))}.
            </p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SectionCard
                title="Most Undervalued"
                icon={<Gem size={16} className="text-emerald-400" />}
                rows={data.top_undervalued}
                accent="text-emerald-300"
                metricLabel="return"
              />
              <SectionCard
                title="Highest Allocation"
                icon={<TrendingUp size={16} className="text-emerald-400" />}
                rows={data.top_highest_allocation}
                accent="text-emerald-300"
                metricLabel="allocation"
              />
              <SectionCard
                title="Most Overvalued"
                icon={<ShieldAlert size={16} className="text-red-400" />}
                rows={data.top_overvalued}
                accent="text-red-300"
                metricLabel="return"
              />
              <SectionCard
                title="Lowest Allocation"
                icon={<TrendingDown size={16} className="text-red-400" />}
                rows={data.top_lowest_allocation}
                accent="text-red-300"
                metricLabel="allocation"
              />
              {lensType === "overall" ? (
                <SectionCard
                  title="Top Conviction"
                  icon={<Radar size={16} className="hib-conviction-accent" />}
                  rows={data.top_conviction}
                  accent="hib-conviction-accent"
                  metricLabel="disagreement"
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
