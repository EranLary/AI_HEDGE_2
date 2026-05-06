"use client";

import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type DiscoveryLensType = "overall" | "model" | "valuator";
type WindowKey = "1w" | "1m" | "1y" | "all";

type PerfPoint = {
  date: string;
  nav: number;
  cumulative_return_pct: number;
};

type PerfSeries = {
  key: string;
  label: string;
  points: PerfPoint[];
};

type ObservatoryPayload = {
  generated_at?: string;
  line_count?: number;
  lens_count?: number;
  windows: Record<string, { key: string; label: string; start_date: string | null }>;
  series: CombinedSeries[];
};

type CombinedSeries = {
  key: string;
  label: string;
  points: PerfPoint[];
  sourceLens: string;
};

type ChartRow = {
  date: string;
  [key: string]: string | number | null;
};

function colorForKey(key: string): string {
  if (key.includes("benchmark_sp500")) return "#f59e0b";
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 68% 56%)`;
}

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

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

function windowizeSeries(series: CombinedSeries[], startDate: string | null): CombinedSeries[] {
  return series.map((line) => {
    const sliced = startDate ? line.points.filter((p) => p.date >= startDate) : line.points.slice();
    if (!sliced.length) return { ...line, points: [] };
    const base = sliced[0].nav;
    return {
      ...line,
      points: sliced.map((p) => ({
        ...p,
        cumulative_return_pct: base > 0 ? ((p.nav / base) - 1) * 100 : 0,
      })),
    };
  });
}

function rowsFromSeries(series: CombinedSeries[]): ChartRow[] {
  const dates = new Set<string>();
  for (const line of series) {
    for (const p of line.points) dates.add(p.date);
  }
  return Array.from(dates)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const row: ChartRow = { date };
      for (const line of series) {
        const point = line.points.find((p) => p.date === date);
        row[line.key] = point ? point.cumulative_return_pct : null;
      }
      return row;
    });
}

export default function ObservatoryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windows, setWindows] = useState<Record<string, { key: string; label: string; start_date: string | null }>>({});
  const [windowKey, setWindowKey] = useState<WindowKey>("1m");
  const [allSeries, setAllSeries] = useState<CombinedSeries[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/observatory", { cache: "no-store" });
        const payload = await readJsonOrThrow<ObservatoryPayload>(res, "Observatory API");
        const combined = Array.isArray(payload.series) ? payload.series : [];

        if (!cancelled) {
          setWindows(payload.windows || {});
          setAllSeries(combined);
          const sorted = combined
            .map((line) => ({
              key: line.key,
              last: line.points.length ? line.points[line.points.length - 1].cumulative_return_pct : Number.NEGATIVE_INFINITY,
            }))
            .sort((a, b) => b.last - a.last)
            .map((row) => row.key);
          const defaultVisible = new Set<string>(sorted.slice(0, 14));
          const benchmarkKey = combined.find((line) => line.label === "S&P 500")?.key;
          if (benchmarkKey) defaultVisible.add(benchmarkKey);
          setVisibleKeys(defaultVisible);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load observatory");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const startDate = windows?.[windowKey]?.start_date || null;

  const windowed = useMemo(() => windowizeSeries(allSeries, startDate), [allSeries, startDate]);
  const visibleSeries = useMemo(
    () => windowed.filter((line) => visibleKeys.has(line.key)),
    [windowed, visibleKeys],
  );
  const chartRows = useMemo(() => rowsFromSeries(visibleSeries), [visibleSeries]);

  const toggleSeries = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 text-zinc-100 sm:px-8">
      <header className="mb-6 rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
        <h1 className="font-display text-2xl">Strategy Observatory</h1>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Unified Discovery Curve Comparison</p>
      </header>

      {loading ? (
        <div className="h-72 animate-pulse rounded-xl border border-white/10 bg-white/5" />
      ) : error ? (
        <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
      ) : (
        <>
          <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-zinc-300">All available strategy curves, overlaid for direct comparison.</p>
              <div className="inline-flex rounded-xl border border-white/15 bg-white/5 p-1 text-xs uppercase tracking-[0.12em]">
                {(["1w", "1m", "1y", "all"] as WindowKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setWindowKey(key)}
                    className={`rounded-lg px-3 py-1.5 transition ${
                      windowKey === key ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"
                    }`}
                  >
                    {windows?.[key]?.label || key.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ left: 12, right: 16, top: 8, bottom: 8 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} width={58} />
                  <Tooltip formatter={(value) => fmtPct(Number(value ?? 0))} labelFormatter={(value) => String(value)} />
                  {visibleSeries.map((line) => {
                    const stroke = colorForKey(line.key);
                    const isBenchmark = line.label === "S&P 500";
                    return (
                      <Line
                        key={line.key}
                        type="monotone"
                        dataKey={line.key}
                        stroke={stroke}
                        strokeWidth={isBenchmark ? 2.8 : 1.7}
                        dot={false}
                        connectNulls
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Visible Curves</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-zinc-200 hover:border-white/30"
                  onClick={() => setVisibleKeys(new Set(allSeries.map((line) => line.key)))}
                >
                  Show All
                </button>
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-zinc-200 hover:border-white/30"
                  onClick={() => setVisibleKeys(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {allSeries.map((line) => {
                const active = visibleKeys.has(line.key);
                const last = line.points.length ? line.points[line.points.length - 1].cumulative_return_pct : null;
                return (
                  <button
                    key={line.key}
                    type="button"
                    onClick={() => toggleSeries(line.key)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                      active
                        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                        : "border-white/10 bg-black/20 text-zinc-300 hover:border-white/20"
                    }`}
                  >
                    <p className="font-semibold" style={{ color: colorForKey(line.key) }}>{line.label}</p>
                    <p className="mt-1 text-zinc-400">{last === null ? "N/A" : fmtPct(last)}</p>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
