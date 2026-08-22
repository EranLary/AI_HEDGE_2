"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";

type PortfolioTrack = "paper" | "backtest";
type PortfolioPeriod = "1m" | "3m" | "6m" | "1y" | "all";
type PortfolioStatus = "ok" | "insufficient_history" | "no_positions" | "stale_market_data";
type PortfolioRiskStatus = "ok" | "insufficient_history" | "risk_free_unavailable" | "stale_market_data";

type PortfolioReturnRow = {
  lens_type: "overall" | "model" | "valuator";
  lens_key: string | null;
  label: string;
  return_pct: number | null;
  benchmark_return_pct: number | null;
  excess_return_pct: number | null;
  portfolio_volatility_pct: number | null;
  benchmark_volatility_pct: number | null;
  portfolio_sharpe: number | null;
  benchmark_sharpe: number | null;
  risk_observation_count: number;
  risk_free_observation_count: number;
  risk_status: PortfolioRiskStatus;
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
    risk_free_symbol: string;
    risk_free_name: string;
    risk_calculation: string;
    annualization_trading_days: number;
    minimum_risk_observations: number;
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

function formatRatio(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return value.toFixed(2);
}

function formatDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "N/A";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function returnTone(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) < 0.005) {
    return "text-[color:var(--text-primary)]";
  }
  return value > 0 ? "text-[color:var(--success)]" : "text-[color:var(--danger)]";
}

function statusLabel(row: PortfolioReturnRow): string | null {
  if (row.status === "insufficient_history") return "Full period unavailable";
  if (row.status === "no_positions") return "No positive positions";
  if (row.status === "stale_market_data") return "Market data incomplete";
  return null;
}

function riskStatusLabel(row: PortfolioReturnRow, minimumObservations: number): string | null {
  if (row.risk_status === "insufficient_history") {
    const remaining = Math.max(0, minimumObservations - row.risk_observation_count);
    return `Risk metrics need ${remaining} more daily return${remaining === 1 ? "" : "s"}`;
  }
  if (row.risk_status === "risk_free_unavailable") {
    return `Treasury data matched ${row.risk_free_observation_count}/${row.risk_observation_count} days; volatility is available but Sharpe is not`;
  }
  if (row.risk_status === "stale_market_data") return "Risk metrics paused because market data is incomplete";
  return null;
}

function sortRowsByReturn(rows: PortfolioReturnRow[]): PortfolioReturnRow[] {
  return rows.slice().sort((a, b) => {
    const aReturn = typeof a.return_pct === "number" && Number.isFinite(a.return_pct) ? a.return_pct : null;
    const bReturn = typeof b.return_pct === "number" && Number.isFinite(b.return_pct) ? b.return_pct : null;
    if (aReturn === null && bReturn === null) return a.label.localeCompare(b.label);
    if (aReturn === null) return 1;
    if (bReturn === null) return -1;
    return bReturn - aReturn || a.label.localeCompare(b.label);
  });
}

function ReturnsTable({
  title,
  rows,
  benchmarkName,
  minimumObservations,
}: {
  title: string;
  rows: PortfolioReturnRow[];
  benchmarkName: string;
  minimumObservations: number;
}) {
  const { href } = useWorkspace();
  const rowHref = (row: PortfolioReturnRow): string => row.lens_type === "overall"
    ? href("/discovery?lens_type=overall")
    : href(`/discovery?lens_type=${row.lens_type}&lens_key=${encodeURIComponent(row.lens_key || row.label)}`);
  const sortedRows = sortRowsByReturn(rows);
  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">{title}</h3>
      <div className="space-y-2 md:hidden">
        {sortedRows.map((row) => {
          const riskNotice = riskStatusLabel(row, minimumObservations);
          return (
            <article key={`${row.lens_type}:${row.lens_key || "overall"}:mobile`} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={rowHref(row)} className="font-semibold text-[color:var(--accent)] underline-offset-2 hover:underline">
                    {row.label}
                  </Link>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">{statusLabel(row) || `${row.holdings_count} latest holdings`}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Excess return</p>
                  <p className={`mt-1 text-lg font-bold tabular-nums ${returnTone(row.excess_return_pct)}`}>{formatPercent(row.excess_return_pct)}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <dl className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-3 text-xs">
                  <dt className="font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Portfolio</dt>
                  <dd className={`mt-2 text-lg font-bold tabular-nums ${returnTone(row.return_pct)}`}>{formatPercent(row.return_pct)}</dd>
                  <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[color:var(--text-muted)]">Volatility</span><span className="tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.portfolio_volatility_pct)}</span></div>
                  <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[color:var(--text-muted)]">Sharpe</span><span className="tabular-nums text-[color:var(--text-primary)]">{formatRatio(row.portfolio_sharpe)}</span></div>
                </dl>
                <dl className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-3 text-xs">
                  <dt className="font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Benchmark</dt>
                  <dd className="mt-2 text-lg font-bold tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.benchmark_return_pct)}</dd>
                  <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[color:var(--text-muted)]">Volatility</span><span className="tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.benchmark_volatility_pct)}</span></div>
                  <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[color:var(--text-muted)]">Sharpe</span><span className="tabular-nums text-[color:var(--text-primary)]">{formatRatio(row.benchmark_sharpe)}</span></div>
                </dl>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--text-muted)]">
                <span>{row.risk_observation_count} daily returns</span>
                <span>Since {formatDate(row.period_start)}</span>
              </div>
              {riskNotice ? <p className="mt-2 text-xs leading-relaxed text-[color:var(--warning)]">{riskNotice}</p> : null}
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border border-[color:var(--border-subtle)] md:block">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="bg-[color:var(--surface)] text-[color:var(--text-muted)]">
            <tr className="border-b border-[color:var(--border-subtle)]">
              <th rowSpan={2} className="px-3 py-2 text-left font-medium">Portfolio</th>
              <th colSpan={3} className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-center font-semibold text-[color:var(--text-secondary)]">Portfolio</th>
              <th colSpan={3} className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-center font-semibold text-[color:var(--text-secondary)]">{benchmarkName}</th>
              <th rowSpan={2} className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-right font-medium">Excess</th>
              <th rowSpan={2} className="px-3 py-2 text-right font-medium">Days</th>
            </tr>
            <tr className="border-b border-[color:var(--border-subtle)] text-[11px] uppercase tracking-[0.08em]">
              <th className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-right font-medium">Return</th>
              <th className="px-3 py-2 text-right font-medium">Volatility</th>
              <th className="px-3 py-2 text-right font-medium">Sharpe</th>
              <th className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-right font-medium">Return</th>
              <th className="px-3 py-2 text-right font-medium">Volatility</th>
              <th className="px-3 py-2 text-right font-medium">Sharpe</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const riskNotice = riskStatusLabel(row, minimumObservations);
              return (
                <tr key={`${row.lens_type}:${row.lens_key || "overall"}`} className="border-b border-[color:var(--border-subtle)] last:border-b-0">
                  <td className="px-3 py-2">
                    <Link href={rowHref(row)} className="font-medium text-[color:var(--accent)] underline-offset-2 hover:underline">{row.label}</Link>
                    <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
                      {statusLabel(row) || `${row.holdings_count} holdings · since ${formatDate(row.period_start)}`}
                    </p>
                    {riskNotice ? <p className="mt-0.5 max-w-56 text-[11px] leading-snug text-[color:var(--warning)]">{riskNotice}</p> : null}
                  </td>
                  <td className={`border-l border-[color:var(--border-subtle)] px-3 py-2 text-right font-semibold tabular-nums ${returnTone(row.return_pct)}`}>{formatPercent(row.return_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.portfolio_volatility_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatRatio(row.portfolio_sharpe)}</td>
                  <td className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.benchmark_return_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.benchmark_volatility_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatRatio(row.benchmark_sharpe)}</td>
                  <td className={`border-l border-[color:var(--border-subtle)] px-3 py-2 text-right tabular-nums ${returnTone(row.excess_return_pct)}`}>{formatPercent(row.excess_return_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-secondary)]">{row.risk_observation_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length ? <p className="text-sm text-[color:var(--text-muted)]">No portfolio history is available yet.</p> : null}
    </section>
  );
}

export function PortfolioReturnsSection() {
  const { workspace, api } = useWorkspace();
  const [track, setTrack] = useState<PortfolioTrack>("paper");
  const [period, setPeriod] = useState<PortfolioPeriod>("all");
  const [data, setData] = useState<PortfolioPerformancePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(api(`/api/portfolio-performance?track=${track}&period=${period}`), { cache: "no-store" });
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
  }, [api, period, track, workspace]);

  const benchmarkName = data?.methodology.benchmark_name || (workspace === "nasdaq100"
    ? "Invesco QQQ - total-return proxy"
    : "S&P 500 Total Return");
  const minimumRiskObservations = data?.methodology.minimum_risk_observations || 20;
  const riskFreeName = data?.methodology.risk_free_name || "13-week U.S. Treasury Bill yield proxy";

  return (
    <section className="mb-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl text-[color:var(--text-primary)]">Portfolio Returns</h2>
            <span className="rounded-full border border-[color:var(--warning)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--warning)]">Public Beta</span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-[color:var(--text-muted)]">Monthly Top 20 positive-score portfolios, equal weighted and measured in USD against {benchmarkName}.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium text-[color:var(--text-secondary)]">
            <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-2.5 py-1">Annualized daily risk</span>
            <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-2.5 py-1">Minimum {minimumRiskObservations} daily returns</span>
            <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-2.5 py-1">Risk-free: {riskFreeName}</span>
          </div>
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
          <ReturnsTable title="Models" rows={data.by_model} benchmarkName={benchmarkName} minimumObservations={minimumRiskObservations} />
          <ReturnsTable title="Valuators" rows={data.by_valuator} benchmarkName={benchmarkName} minimumObservations={minimumRiskObservations} />
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-[color:var(--text-muted)]">
        {track === "paper"
          ? "Paper records each portfolio from the day it is created, and its holdings are never rewritten later. "
          : "Backtest reconstructs what each portfolio would have held at earlier month-ends, using only information available at the time. "}
        Benchmark: every portfolio is compared with {benchmarkName}. {workspace === "nasdaq100" ? "QQQ adjusted close is used as an investable total-return proxy; it is not presented as the official XNDX index series. Only reports from a completed, fully covered Nasdaq 100 release can enter the ranking. " : "The Analysis benchmark is the full S&P 500 Total Return Index, including reinvested dividends. Only stocks analyzed during the previous 90 days can enter the ranking; that does not narrow the benchmark. "}Volatility is the annualized sample standard deviation of daily returns. Sharpe compares daily returns with the daily-matched {riskFreeName} yield and is annualized over 252 trading days; it appears after {minimumRiskObservations} daily returns. Latest holdings is the count at the most recent frozen rebalance, so it can differ from today&apos;s live Discovery ranking. Returns are simulated before fees, taxes, slippage, or cash interest. Prices, Treasury yield, and FX come from yfinance; missing data is shown explicitly.
      </p>
    </section>
  );
}
