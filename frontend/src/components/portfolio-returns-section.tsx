"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type PortfolioTrack = "paper" | "backtest";
type PortfolioPeriod = "1m" | "3m" | "6m" | "1y" | "all";
type PortfolioStatus = "ok" | "insufficient_history" | "no_positions" | "stale_market_data";

type PortfolioReturnRow = {
  lens_type: "overall" | "model" | "valuator";
  lens_key: string | null;
  label: string;
  return_pct: number | null;
  benchmark_return_pct: number | null;
  excess_return_pct: number | null;
  holdings_count: number;
  period_start: string | null;
  period_end: string | null;
  status: PortfolioStatus;
};

type PortfolioPerformancePayload = {
  generated_at: string;
  track: PortfolioTrack;
  period: PortfolioPeriod;
  available: boolean;
  message: string | null;
  methodology: {
    version: string;
    universe: string;
    construction: string;
    return_type: string;
    benchmark_name: string;
    market_data_provider: string;
    public_beta: boolean;
  };
  range: { start: string | null; end: string | null };
  by_model: PortfolioReturnRow[];
  by_valuator: PortfolioReturnRow[];
};

const PERIODS: Array<{ value: PortfolioPeriod; label: string }> = [
  { value: "all", label: "Since Inception" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
];

function formatPercent(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "N/A";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

function returnTone(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) < 0.005) {
    return "text-[color:var(--text-primary)]";
  }
  return value > 0 ? "text-[color:var(--success)]" : "text-[color:var(--danger)]";
}

function rowHref(row: PortfolioReturnRow): string {
  if (row.lens_type === "overall") return "/discovery?lens_type=overall";
  return `/discovery?lens_type=${row.lens_type}&lens_key=${encodeURIComponent(row.lens_key || row.label)}`;
}

function statusLabel(row: PortfolioReturnRow): string | null {
  if (row.status === "insufficient_history") return "Full period unavailable";
  if (row.status === "no_positions") return "No positive positions";
  if (row.status === "stale_market_data") return "Market data incomplete";
  return null;
}

function ReturnsTable({ title, rows }: { title: string; rows: PortfolioReturnRow[] }) {
  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">{title}</h3>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <article key={`${row.lens_type}:${row.lens_key || "overall"}:mobile`} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={rowHref(row)} className="font-semibold text-[color:var(--accent)] underline-offset-2 hover:underline">
                  {row.label}
                </Link>
                <p className="mt-1 text-xs text-[color:var(--text-muted)]">{statusLabel(row) || `${row.holdings_count} holdings`}</p>
              </div>
              <p className={`text-xl font-bold tabular-nums ${returnTone(row.return_pct)}`}>{formatPercent(row.return_pct)}</p>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div><dt className="text-[color:var(--text-muted)]">S&amp;P 500 TR</dt><dd className="mt-1 tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.benchmark_return_pct)}</dd></div>
              <div><dt className="text-[color:var(--text-muted)]">Excess</dt><dd className={`mt-1 tabular-nums ${returnTone(row.excess_return_pct)}`}>{formatPercent(row.excess_return_pct)}</dd></div>
              <div><dt className="text-[color:var(--text-muted)]">Start</dt><dd className="mt-1 text-[color:var(--text-primary)]">{formatDate(row.period_start)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border border-[color:var(--border-subtle)] md:block">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-[color:var(--surface)] text-[color:var(--text-muted)]">
            <tr className="border-b border-[color:var(--border-subtle)]">
              <th className="px-3 py-2 text-left font-medium">Portfolio</th>
              <th className="px-3 py-2 text-right font-medium">Portfolio return</th>
              <th className="px-3 py-2 text-right font-medium">S&amp;P 500 TR</th>
              <th className="px-3 py-2 text-right font-medium">Excess</th>
              <th className="px-3 py-2 text-right font-medium">Holdings</th>
              <th className="px-3 py-2 text-right font-medium">Start</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.lens_type}:${row.lens_key || "overall"}`} className="border-b border-[color:var(--border-subtle)] last:border-b-0">
                <td className="px-3 py-2">
                  <Link href={rowHref(row)} className="font-medium text-[color:var(--accent)] underline-offset-2 hover:underline">{row.label}</Link>
                  {statusLabel(row) ? <p className="text-xs text-[color:var(--text-muted)]">{statusLabel(row)}</p> : null}
                </td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${returnTone(row.return_pct)}`}>{formatPercent(row.return_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.benchmark_return_pct)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${returnTone(row.excess_return_pct)}`}>{formatPercent(row.excess_return_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-secondary)]">{row.holdings_count}</td>
                <td className="px-3 py-2 text-right text-[color:var(--text-secondary)]">{formatDate(row.period_start)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="text-sm text-[color:var(--text-muted)]">No portfolio history is available yet.</p> : null}
    </section>
  );
}

export function PortfolioReturnsSection() {
  const [track, setTrack] = useState<PortfolioTrack>("paper");
  const [period, setPeriod] = useState<PortfolioPeriod>("all");
  const [data, setData] = useState<PortfolioPerformancePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/portfolio-performance?track=${track}&period=${period}`, { cache: "no-store" });
        const payload = (await response.json()) as PortfolioPerformancePayload;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [period, track]);

  return (
    <section className="mb-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl text-[color:var(--text-primary)]">Portfolio Returns</h2>
            <span className="rounded-full border border-[color:var(--warning)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--warning)]">Public Beta</span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-[color:var(--text-muted)]">Monthly Top 20 positive-score portfolios, equal weighted and measured in USD against the S&amp;P 500 Total Return Index.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-1" aria-label="Portfolio track">
            {(["paper", "backtest"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setTrack(value)} disabled={loading && track !== value} className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] ${track === value ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"}`}>
                {value === "paper" ? "Paper" : "Backtest"}
              </button>
            ))}
          </div>
          <select aria-label="Return period" value={period} onChange={(event) => setPeriod(event.target.value as PortfolioPeriod)} disabled={loading} className="rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)]">
            {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="h-40 animate-pulse rounded-xl bg-[color:var(--border-subtle)]" />
          <div className="h-40 animate-pulse rounded-xl bg-[color:var(--border-subtle)]" />
        </div>
      ) : !data?.available ? (
        <div className="mt-4 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--text-muted)]">
          {data?.message || "Portfolio performance history is not available yet."}
        </div>
      ) : (
        <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
          <ReturnsTable title="Models" rows={data.by_model} />
          <ReturnsTable title="Personas" rows={data.by_valuator} />
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-[color:var(--text-muted)]">
        {track === "paper" ? "Forward Paper uses immutable portfolio snapshots from launch. " : "Reconstructed Backtest uses only reports and prices available at each historical cutoff. "}
        Universe: analyzed tickers with reports in the trailing 90 days—not the full S&amp;P 500. Gross simulated total returns exclude fees, slippage, taxes, and cash interest. Adjusted prices and FX are sourced from yfinance for research/personal-use beta evaluation; missing or stale market data is never silently filled.
      </p>
    </section>
  );
}
