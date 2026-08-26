"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";

type PortfolioTrack = "paper" | "backtest";
type PortfolioPeriod = "1m" | "3m" | "6m" | "1y" | "all";
type PortfolioMethodologyKey = "equal" | "score_blend";
type PortfolioMethodologyView = "compare" | PortfolioMethodologyKey;
type PortfolioRefreshHealthState = "fresh" | "running" | "partial" | "failed" | "stale" | "missing";
type PortfolioRefreshRunStatus = "running" | "completed" | "partial" | "failed";
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
  portfolio_key: string;
  latest_snapshot_id: string;
  cutoff_at: string | null;
  execution_date: string | null;
  trade_eligibility: { eligible: boolean; reasons: string[] };
};

type PortfolioPerformancePayload = {
  generated_at: string;
  track: PortfolioTrack;
  period: PortfolioPeriod;
  available: boolean;
  message: string | null;
  methodology: {
    key: PortfolioMethodologyKey;
    version: string;
    label: string;
    short_label: string;
    trade_execution_released: boolean;
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
  refresh: {
    state: PortfolioRefreshHealthState;
    expected_after: string;
    latest_status: PortfolioRefreshRunStatus | null;
    latest_started_at: string | null;
    latest_finished_at: string | null;
    last_successful_at: string | null;
    last_usable_at: string | null;
    provider_warning_count: number;
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

const METHODOLOGY_VIEWS: Array<{ value: PortfolioMethodologyView; label: string }> = [
  { value: "compare", label: "Compare" },
  { value: "equal", label: "Equal Weight" },
  { value: "score_blend", label: "60/40 Score" },
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

function formatRefreshTimestamp(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hour}:${minute} UTC`;
}

function refreshStateLabel(state: PortfolioRefreshHealthState): string {
  if (state === "fresh") return "Fresh";
  if (state === "running") return "Refreshing";
  if (state === "partial") return "Partial";
  if (state === "failed") return "Failed";
  if (state === "stale") return "Stale";
  return "No history";
}

function refreshStateTone(state: PortfolioRefreshHealthState): string {
  if (state === "fresh") return "text-[color:var(--success)]";
  if (state === "running") return "text-[color:var(--info)]";
  if (state === "partial" || state === "missing") return "text-[color:var(--warning)]";
  return "text-[color:var(--danger)]";
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
  track,
  canConnect,
}: {
  title: string;
  rows: PortfolioReturnRow[];
  benchmarkName: string;
  minimumObservations: number;
  track: PortfolioTrack;
  canConnect: boolean;
}) {
  const { href } = useWorkspace();
  const rowHref = (row: PortfolioReturnRow): string => row.lens_type === "overall"
    ? href("/discovery?lens_type=overall")
    : href(`/discovery?lens_type=${row.lens_type}&lens_key=${encodeURIComponent(row.lens_key || row.label)}`);
  const tradingHref = (row: PortfolioReturnRow): string => href(`/trading?portfolio=${encodeURIComponent(row.portfolio_key)}`);
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
                  {track === "paper" && canConnect ? (
                    <Link href={tradingHref(row)} className="mt-2 inline-flex rounded-md border border-[color:var(--accent)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)] hover:bg-[color:var(--surface-elevated)]">
                      Connect
                    </Link>
                  ) : null}
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
                    {track === "paper" && canConnect ? (
                      <Link href={tradingHref(row)} className="mt-1.5 inline-flex rounded-md border border-[color:var(--accent)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)] hover:bg-[color:var(--surface)]">
                        Connect
                      </Link>
                    ) : null}
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

type ComparedRow = {
  key: string;
  label: string;
  reference: PortfolioReturnRow;
  equal: PortfolioReturnRow | null;
  scoreBlend: PortfolioReturnRow | null;
};

function pairRows(equalRows: PortfolioReturnRow[], scoreBlendRows: PortfolioReturnRow[]): ComparedRow[] {
  const pairs = new Map<string, ComparedRow>();
  for (const row of equalRows) {
    const key = `${row.lens_type}:${row.lens_key || "overall"}`;
    pairs.set(key, { key, label: row.label, reference: row, equal: row, scoreBlend: null });
  }
  for (const row of scoreBlendRows) {
    const key = `${row.lens_type}:${row.lens_key || "overall"}`;
    const existing = pairs.get(key);
    pairs.set(key, existing
      ? { ...existing, scoreBlend: row }
      : { key, label: row.label, reference: row, equal: null, scoreBlend: row });
  }
  return Array.from(pairs.values()).sort((a, b) => {
    const aReturn = a.equal?.return_pct ?? a.scoreBlend?.return_pct ?? Number.NEGATIVE_INFINITY;
    const bReturn = b.equal?.return_pct ?? b.scoreBlend?.return_pct ?? Number.NEGATIVE_INFINITY;
    return bReturn - aReturn || a.label.localeCompare(b.label);
  });
}

function comparisonReturnDifference(pair: ComparedRow): number | null {
  if (
    !pair.equal
    || !pair.scoreBlend
    || pair.equal.return_pct === null
    || pair.scoreBlend.return_pct === null
    || pair.equal.period_start !== pair.scoreBlend.period_start
    || pair.equal.period_end !== pair.scoreBlend.period_end
  ) return null;
  return pair.scoreBlend.return_pct - pair.equal.return_pct;
}

function ComparisonMetrics({ row, label }: { row: PortfolioReturnRow | null; label: string }) {
  return (
    <dl className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-3 text-xs">
      <dt className="font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">{label}</dt>
      {row ? (
        <>
          <dd className={`mt-2 text-lg font-bold tabular-nums ${returnTone(row.return_pct)}`}>{formatPercent(row.return_pct)}</dd>
          <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[color:var(--text-muted)]">Volatility</span><span className="tabular-nums text-[color:var(--text-primary)]">{formatPercent(row.portfolio_volatility_pct)}</span></div>
          <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[color:var(--text-muted)]">Sharpe</span><span className="tabular-nums text-[color:var(--text-primary)]">{formatRatio(row.portfolio_sharpe)}</span></div>
        </>
      ) : <dd className="mt-2 leading-relaxed text-[color:var(--text-muted)]">Awaiting first snapshot</dd>}
    </dl>
  );
}

function ComparisonTable({
  title,
  equalRows,
  scoreBlendRows,
}: {
  title: string;
  equalRows: PortfolioReturnRow[];
  scoreBlendRows: PortfolioReturnRow[];
}) {
  const { href } = useWorkspace();
  const rows = pairRows(equalRows, scoreBlendRows);
  const rowHref = (row: PortfolioReturnRow): string => row.lens_type === "overall"
    ? href("/discovery?lens_type=overall")
    : href(`/discovery?lens_type=${row.lens_type}&lens_key=${encodeURIComponent(row.lens_key || row.label)}`);
  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">{title}</h3>
      <div className="space-y-2 md:hidden">
        {rows.map((pair) => {
          const difference = comparisonReturnDifference(pair);
          return (
            <article key={`${pair.key}:comparison-mobile`} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={rowHref(pair.reference)} className="font-semibold text-[color:var(--accent)] underline-offset-2 hover:underline">{pair.label}</Link>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">60/40 difference</p>
                  <p className={`mt-1 font-bold tabular-nums ${returnTone(difference)}`}>{formatPercent(difference)}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <ComparisonMetrics row={pair.equal} label="Equal" />
                <ComparisonMetrics row={pair.scoreBlend} label="60/40" />
              </div>
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border border-[color:var(--border-subtle)] md:block">
        <table className="w-full min-w-[940px] text-sm">
          <thead className="bg-[color:var(--surface)] text-[color:var(--text-muted)]">
            <tr className="border-b border-[color:var(--border-subtle)]">
              <th rowSpan={2} className="px-3 py-2 text-left font-medium">Portfolio</th>
              <th colSpan={3} className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-center font-semibold text-[color:var(--text-secondary)]">Equal Weight</th>
              <th colSpan={3} className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-center font-semibold text-[color:var(--text-secondary)]">60/40 Score Blend</th>
              <th rowSpan={2} className="border-l border-[color:var(--border-subtle)] px-3 py-2 text-right font-medium">Return difference</th>
            </tr>
            <tr className="border-b border-[color:var(--border-subtle)] text-[11px] uppercase tracking-[0.08em]">
              {(["Return", "Volatility", "Sharpe", "Return", "Volatility", "Sharpe"] as const).map((label, index) => (
                <th key={`${label}:${index}`} className={`${index === 0 || index === 3 ? "border-l border-[color:var(--border-subtle)] " : ""}px-3 py-2 text-right font-medium`}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((pair) => {
              const difference = comparisonReturnDifference(pair);
              return (
                <tr key={pair.key} className="border-b border-[color:var(--border-subtle)] last:border-b-0">
                  <td className="px-3 py-2">
                    <Link href={rowHref(pair.reference)} className="font-medium text-[color:var(--accent)] underline-offset-2 hover:underline">{pair.label}</Link>
                    <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">{pair.reference.holdings_count} latest holdings</p>
                  </td>
                  <td className={`border-l border-[color:var(--border-subtle)] px-3 py-2 text-right font-semibold tabular-nums ${returnTone(pair.equal?.return_pct ?? null)}`}>{formatPercent(pair.equal?.return_pct ?? null)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatPercent(pair.equal?.portfolio_volatility_pct ?? null)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatRatio(pair.equal?.portfolio_sharpe ?? null)}</td>
                  <td className={`border-l border-[color:var(--border-subtle)] px-3 py-2 text-right font-semibold tabular-nums ${returnTone(pair.scoreBlend?.return_pct ?? null)}`}>{formatPercent(pair.scoreBlend?.return_pct ?? null)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatPercent(pair.scoreBlend?.portfolio_volatility_pct ?? null)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[color:var(--text-primary)]">{formatRatio(pair.scoreBlend?.portfolio_sharpe ?? null)}</td>
                  <td className={`border-l border-[color:var(--border-subtle)] px-3 py-2 text-right font-semibold tabular-nums ${returnTone(difference)}`}>{formatPercent(difference)}</td>
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

function RefreshHealthCard({
  label,
  payload,
}: {
  label: string;
  payload: PortfolioPerformancePayload | null;
}) {
  const refresh = payload?.refresh;
  const state = refresh?.state || "missing";
  const latestAttemptAt = refresh?.latest_finished_at || refresh?.latest_started_at || null;
  return (
    <article className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold text-[color:var(--text-primary)]">{label}</h4>
        <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${refreshStateTone(state)}`}>
          {refreshStateLabel(state)}
        </span>
      </div>
      <dl className="mt-2 space-y-1 text-[11px] text-[color:var(--text-muted)]">
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <dt>Last successful</dt>
          <dd className="tabular-nums text-[color:var(--text-secondary)]">{formatRefreshTimestamp(refresh?.last_successful_at || null)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <dt>Latest attempt</dt>
          <dd className="tabular-nums text-[color:var(--text-secondary)]">
            {refresh?.latest_status ? `${refresh.latest_status} · ${formatRefreshTimestamp(latestAttemptAt)}` : "Not recorded"}
          </dd>
        </div>
        {refresh?.provider_warning_count ? (
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[color:var(--warning)]">
            <dt>Provider warnings</dt>
            <dd className="tabular-nums">{refresh.provider_warning_count}</dd>
          </div>
        ) : null}
        {(state === "stale" || state === "missing") && refresh?.expected_after ? (
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[color:var(--danger)]">
            <dt>Expected refresh</dt>
            <dd className="tabular-nums">{formatRefreshTimestamp(refresh.expected_after)}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

export function PortfolioReturnsSection() {
  const { workspace, api } = useWorkspace();
  const [selectedTrack, setSelectedTrack] = useState<PortfolioTrack>("paper");
  const track: PortfolioTrack = workspace === "nasdaq100" ? "paper" : selectedTrack;
  const [period, setPeriod] = useState<PortfolioPeriod>("all");
  const [methodologyView, setMethodologyView] = useState<PortfolioMethodologyView>("compare");
  const [dataByMethodology, setDataByMethodology] = useState<Record<PortfolioMethodologyKey, PortfolioPerformancePayload | null>>({
    equal: null,
    score_blend: null,
  });
  const [comparisonByMethodology, setComparisonByMethodology] = useState<Record<PortfolioMethodologyKey, PortfolioPerformancePayload | null>>({
    equal: null,
    score_blend: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const entries = await Promise.all((["equal", "score_blend"] as const).map(async (methodology) => {
          const response = await fetch(
            api(`/api/portfolio-performance?track=${track}&period=${period}&methodology=${methodology}`),
            { cache: "no-store" },
          );
          if (!response.ok) return [methodology, null] as const;
          return [methodology, (await response.json()) as PortfolioPerformancePayload] as const;
        }));
        const loaded = Object.fromEntries(entries) as Record<PortfolioMethodologyKey, PortfolioPerformancePayload | null>;
        let comparison = loaded;
        const availableStarts = Object.values(loaded)
          .filter((payload): payload is PortfolioPerformancePayload => Boolean(payload?.available && payload.range.start))
          .map((payload) => payload.range.start as string);
        if (period === "all" && availableStarts.length === 2 && availableStarts[0] !== availableStarts[1]) {
          const commonStart = availableStarts.sort().at(-1) as string;
          const alignedEntries = await Promise.all((["equal", "score_blend"] as const).map(async (methodology) => {
            const payload = loaded[methodology];
            if (!payload?.available || payload.range.start === commonStart) return [methodology, payload] as const;
            const response = await fetch(
              api(`/api/portfolio-performance?track=${track}&period=all&methodology=${methodology}&start=${commonStart}`),
              { cache: "no-store" },
            );
            return [methodology, response.ok ? (await response.json()) as PortfolioPerformancePayload : null] as const;
          }));
          comparison = Object.fromEntries(alignedEntries) as Record<PortfolioMethodologyKey, PortfolioPerformancePayload | null>;
        }
        if (!cancelled) {
          setDataByMethodology(loaded);
          setComparisonByMethodology(comparison);
        }
      } catch {
        if (!cancelled) {
          setDataByMethodology({ equal: null, score_blend: null });
          setComparisonByMethodology({ equal: null, score_blend: null });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [api, period, track, workspace]);

  const equalData = dataByMethodology.equal;
  const scoreBlendData = dataByMethodology.score_blend;
  const equalComparisonData = comparisonByMethodology.equal;
  const scoreBlendComparisonData = comparisonByMethodology.score_blend;
  const selectedData = methodologyView === "compare" ? null : dataByMethodology[methodologyView];
  const metadataSource = equalData || scoreBlendData;
  const benchmarkName = metadataSource?.methodology.benchmark_name || (workspace === "nasdaq100"
    ? "Invesco QQQ - total-return proxy"
    : "S&P 500 Total Return");
  const minimumRiskObservations = metadataSource?.methodology.minimum_risk_observations || 20;
  const riskFreeName = metadataSource?.methodology.risk_free_name || "13-week U.S. Treasury Bill yield proxy";
  const comparisonAvailable = Boolean(equalData?.available || scoreBlendData?.available);
  const visibleAvailable = methodologyView === "compare" ? comparisonAvailable : Boolean(selectedData?.available);
  const unavailableMessage = methodologyView === "compare"
    ? equalData?.message || scoreBlendData?.message
    : selectedData?.message;
  const refreshEntries = [
    { label: "Equal Weight", payload: equalData },
    { label: "60/40 Score", payload: scoreBlendData },
  ];
  const refreshIssues = refreshEntries.filter(({ payload }) => (
    !payload || ["partial", "failed", "stale", "missing"].includes(payload.refresh.state)
  ));
  const hasCriticalRefreshIssue = refreshIssues.some(({ payload }) => (
    !payload || payload.refresh.state === "failed" || payload.refresh.state === "stale"
  ));

  return (
    <section className="mb-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl text-[color:var(--text-primary)]">Portfolio Returns</h2>
            <span className="rounded-full border border-[color:var(--warning)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--warning)]">Public Beta</span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-[color:var(--text-muted)]">Compare monthly Top 20 positive-score portfolios using equal weight or a 60% equal / 40% score blend capped at 2x equal weight.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium text-[color:var(--text-secondary)]">
            <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-2.5 py-1">Annualized daily risk</span>
            <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-2.5 py-1">Minimum {minimumRiskObservations} daily returns</span>
            <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-2.5 py-1">Risk-free: {riskFreeName}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspace === "analysis" ? (
            <div className="inline-flex rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-1" aria-label="Portfolio track">
              {(["paper", "backtest"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setSelectedTrack(value)} disabled={loading && track !== value} className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] ${track === value ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"}`}>
                  {value === "paper" ? "Paper" : "Backtest"}
                </button>
              ))}
            </div>
          ) : null}
          <select aria-label="Return period" value={period} onChange={(event) => setPeriod(event.target.value as PortfolioPeriod)} disabled={loading} className="rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-xs font-semibold text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)]">
            {PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border-subtle)] pt-4">
        <div className="inline-flex flex-wrap rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-1" aria-label="Portfolio methodology view">
          {METHODOLOGY_VIEWS.map((option) => (
            <button key={option.value} type="button" onClick={() => setMethodologyView(option.value)} disabled={loading && methodologyView !== option.value} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] ${methodologyView === option.value ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"}`}>
              {option.label}
            </button>
          ))}
        </div>
        <p className="max-w-2xl text-xs text-[color:var(--text-muted)]">
          {methodologyView === "compare"
            ? "Return difference is 60/40 minus Equal Weight over the same dates; positive means the score blend led."
            : selectedData?.methodology.construction}
        </p>
      </div>

      {!loading ? (
        <section className="mt-4" aria-label="Portfolio refresh health">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">Data refresh health</h3>
            <p className="text-[11px] text-[color:var(--text-muted)]">Schedule-aware for the selected {track === "paper" ? "Paper" : "Backtest"} track</p>
          </div>
          {refreshIssues.length ? (
            <div className={`mb-2 rounded-lg border bg-[color:var(--surface)] px-3 py-2 text-xs ${hasCriticalRefreshIssue ? "border-[color:var(--danger)] text-[color:var(--danger)]" : "border-[color:var(--warning)] text-[color:var(--warning)]"}`} role="alert">
              Refresh attention: {refreshIssues.map(({ label, payload }) => `${label} is ${refreshStateLabel(payload?.refresh.state || "missing").toLowerCase()}`).join("; ")}. Stored returns remain visible, but compare the newest period only after both are Fresh.
            </div>
          ) : null}
          <div className="grid gap-2 md:grid-cols-2">
            <RefreshHealthCard label="Equal Weight" payload={equalData} />
            <RefreshHealthCard label="60/40 Score" payload={scoreBlendData} />
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="h-40 animate-pulse rounded-xl bg-[color:var(--border-subtle)]" />
          <div className="h-40 animate-pulse rounded-xl bg-[color:var(--border-subtle)]" />
        </div>
      ) : !visibleAvailable ? (
        <div className="mt-4 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--text-muted)]">
          {unavailableMessage || "Portfolio performance history is not available yet."}
        </div>
      ) : methodologyView === "compare" ? (
        <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
          <ComparisonTable title="Models" equalRows={equalComparisonData?.by_model || []} scoreBlendRows={scoreBlendComparisonData?.by_model || []} />
          <ComparisonTable title="Valuators" equalRows={equalComparisonData?.by_valuator || []} scoreBlendRows={scoreBlendComparisonData?.by_valuator || []} />
        </div>
      ) : (
        <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
          <ReturnsTable title="Models" rows={selectedData?.by_model || []} benchmarkName={benchmarkName} minimumObservations={minimumRiskObservations} track={track} canConnect={Boolean(selectedData?.methodology.trade_execution_released)} />
          <ReturnsTable title="Valuators" rows={selectedData?.by_valuator || []} benchmarkName={benchmarkName} minimumObservations={minimumRiskObservations} track={track} canConnect={Boolean(selectedData?.methodology.trade_execution_released)} />
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-[color:var(--text-muted)]">
        {track === "paper"
          ? "Paper records each methodology separately from the day it is created, and its holdings are never rewritten later; the 60/40 series begins forward from its launch refresh. "
          : "Backtest reconstructs what each portfolio would have held at earlier month-ends, using only information available at the time. "}
        Both methods use the same candidates, rebalance dates, prices, and {benchmarkName}; only position weights differ. {workspace === "nasdaq100" ? "QQQ adjusted close is used as an investable total-return proxy; it is not presented as the official XNDX index series. Only reports from a completed, fully covered Nasdaq 100 release can enter the ranking. " : "The Analysis benchmark is the full S&P 500 Total Return Index, including reinvested dividends. Only stocks analyzed during the previous 90 days can enter the ranking; that does not narrow the benchmark. "}Volatility is the annualized sample standard deviation of daily returns. Sharpe compares daily returns with the daily-matched {riskFreeName} yield and is annualized over 252 trading days; it appears after {minimumRiskObservations} daily returns. Latest holdings is the count at the most recent frozen rebalance, so it can differ from today&apos;s live Discovery ranking. Returns are simulated before fees, taxes, slippage, or cash interest. Prices, Treasury yield, and FX come from yfinance; missing data is shown explicitly. The new 60/40 methodology is visible in Paper but is not released to automated trading.
      </p>
    </section>
  );
}
