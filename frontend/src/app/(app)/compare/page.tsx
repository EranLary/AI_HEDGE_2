"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Check, Download, GitCompareArrows, Loader2, Plus, X } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { TickerSearch } from "@/components/shell/ticker-search";
import type { TickerEntry } from "@/lib/ticker-catalog";
import { useThemeTokens } from "@/lib/theme-tokens";

const MAX_TICKERS = 10;

const PERIODS = [
  { key: "1D", label: "1D", days: 1 },
  { key: "1W", label: "1W", days: 7 },
  { key: "1M", label: "1M", days: 30 },
  { key: "3M", label: "3M", days: 90 },
  { key: "6M", label: "6M", days: 182 },
  { key: "YTD", label: "YTD", days: null },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "3Y", label: "3Y", days: 365 * 3 },
  { key: "5Y", label: "5Y", days: 365 * 5 },
] as const;

const FINANCIAL_DOWNLOAD_PERIODS = [
  { key: "annual", label: "Annual" },
  { key: "quarterly", label: "Quarterly" },
  { key: "both", label: "Both" },
] as const;

function financialPeriodFilenamePart(period: (typeof FINANCIAL_DOWNLOAD_PERIODS)[number]["key"]): string {
  return period === "both" ? "annual-quarterly" : period;
}

const CHART_TOKENS = [
  "--chart-grid",
  "--chart-axis",
  "--chart-current",
  "--chart-series-1",
  "--chart-series-2",
  "--chart-series-3",
  "--chart-series-4",
  "--chart-series-6",
  "--chart-bear",
] as const;

type PricePoint = { date: string; close: number };

type CompareFundamentals = {
  ticker?: string;
  symbol?: string;
  company_name?: string;
  market_cap?: number | null;
  enterprise_value?: number | null;
  net_cash_debt?: number | null;
  trailing_pe?: number | null;
  forward_pe?: number | null;
  ev_sales?: number | null;
  ev_ebitda?: number | null;
  p_fcf?: number | null;
  revenue_growth?: number | null;
  earnings_growth?: number | null;
  gross_margin?: number | null;
  operating_margin?: number | null;
  profit_margin?: number | null;
  roe?: number | null;
  current_ratio?: number | null;
  debt_to_equity?: number | null;
  dividend_yield?: number | null;
  target_upside?: number | null;
};

type CompareSeries = {
  ticker: string;
  company_name: string;
  exchange?: string;
  currency?: string;
  current_price?: number | null;
  volume?: number | null;
  fifty_two_week_high?: number | null;
  fifty_two_week_low?: number | null;
  fundamentals?: CompareFundamentals | null;
  prices: PricePoint[];
};

type ComparePayload = {
  status?: string;
  series?: CompareSeries[];
  not_found?: string[];
  error?: string;
  financials?: {
    generated_at?: string;
    tickers?: string[];
    requested_period?: string;
    data?: Record<string, unknown>;
    not_found?: string[];
  };
};

type TableRow = CompareSeries & {
  returnPct: number | null;
  startPrice: number | null;
  endPrice: number | null;
};

function numeric(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function periodStartDate(periodKey: string, latestDate: Date): Date {
  if (periodKey === "YTD") return new Date(latestDate.getFullYear(), 0, 1);
  const option = PERIODS.find((item) => item.key === periodKey);
  const start = new Date(latestDate);
  start.setDate(start.getDate() - (option?.days ?? 365));
  return start;
}

function slicePricesForPeriod(prices: PricePoint[], start: Date): PricePoint[] {
  const filtered = prices.filter((point) => {
    const date = parseDate(point.date);
    return date ? date >= start : false;
  });
  return filtered.length >= 2 ? filtered : prices.slice(-2);
}

function formatReturn(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatRatio(value: unknown): string {
  const n = numeric(value);
  if (n === null || n <= 0) return "-";
  return `${n.toFixed(1)}x`;
}

function formatPercentValue(value: unknown): string {
  const n = numeric(value);
  if (n === null) return "-";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function formatLarge(value: unknown): string {
  const n = numeric(value);
  if (n === null) return "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function returnTone(value: number | null): string {
  if (value === null) return "text-[color:var(--text-muted)]";
  if (value > 0) return "text-[color:var(--success)]";
  if (value < 0) return "text-[color:var(--danger)]";
  return "text-[color:var(--text-secondary)]";
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="hib-chart-tooltip rounded-lg border border-white/15 bg-zinc-950/95 px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-[color:var(--text-primary)]">{label}</p>
      <div className="grid gap-1">
        {payload
          .filter((item) => typeof item.value === "number" && Number.isFinite(item.value))
          .sort((a, b) => Number(b.value) - Number(a.value))
          .map((item) => (
            <p key={item.name} className="flex min-w-36 items-center justify-between gap-3 text-xs">
              <span className="font-mono" style={{ color: item.color }}>
                {item.name}
              </span>
              <span className="font-semibold text-[color:var(--text-secondary)]">{formatReturn(Number(item.value))}</span>
            </p>
          ))}
      </div>
    </div>
  );
}

export default function ComparePage() {
  const tokens = useThemeTokens(CHART_TOKENS);
  const [selected, setSelected] = useState<TickerEntry | null>(null);
  const [tickers, setTickers] = useState<string[]>(["AAPL", "MSFT", "GOOGL"]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("1Y");
  const [financialDownloadPeriod, setFinancialDownloadPeriod] =
    useState<(typeof FINANCIAL_DOWNLOAD_PERIODS)[number]["key"]>("annual");
  const [data, setData] = useState<ComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadingFinancials, setDownloadingFinancials] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  function addTicker(entry: TickerEntry | null) {
    if (!entry) return;
    const ticker = entry.s.trim().toUpperCase();
    setSelected(null);
    setError("");
    if (!ticker || tickers.includes(ticker) || tickers.length >= MAX_TICKERS) return;
    setTickers((prev) => [...prev, ticker]);
  }

  function removeTicker(ticker: string) {
    setTickers((prev) => prev.filter((item) => item !== ticker));
  }

  async function downloadFinancials() {
    if (!tickers.length || downloadingFinancials) return;
    setDownloadingFinancials(true);
    setDownloadStatus(null);
    try {
      const qs = new URLSearchParams({
        tickers: tickers.join(","),
        financials: "1",
        financial_period: financialDownloadPeriod,
      });
      const res = await fetch(`/api/compare?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Financials export failed (${res.status})`);
      const payload = (await res.json()) as ComparePayload;
      const financials = payload.financials || {
        generated_at: new Date().toISOString(),
        tickers,
        requested_period: financialDownloadPeriod,
        data: {},
        not_found: payload.not_found || [],
      };
      const downloadedCount = Object.keys(financials.data || {}).length;
      if (!downloadedCount) throw new Error("No financial statements were available for the selected tickers.");
      const timestamp = new Date().toISOString().slice(0, 10);
      const periodPart = financialPeriodFilenamePart(financialDownloadPeriod);
      downloadTextFile(`comparison-financials-${periodPart}-${timestamp}.txt`, JSON.stringify(financials, null, 2));
      setDownloadStatus({
        tone: "success",
        message: `Downloaded ${financialDownloadPeriod} financial JSON for ${downloadedCount} ticker${downloadedCount === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setDownloadStatus({
        tone: "error",
        message: err instanceof Error ? err.message : "Could not download financials.",
      });
    } finally {
      setDownloadingFinancials(false);
    }
  }

  useEffect(() => {
    if (!tickers.length) {
      queueMicrotask(() => {
        setData(null);
        setError("");
      });
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      setLoading(true);
      setError("");
      setDownloadStatus(null);
    });
    const qs = new URLSearchParams({ tickers: tickers.join(",") });
    fetch(`/api/compare?${qs.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Compare lookup failed (${res.status})`);
        return (await res.json()) as ComparePayload;
      })
      .then((payload) => {
        setData(payload);
        setError(String(payload.error || ""));
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setData(null);
        setError(err.message || "Compare lookup failed.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [tickers]);

  const comparison = useMemo(() => {
    const series = (data?.series || [])
      .map((item) => ({
        ...item,
        ticker: item.ticker.toUpperCase(),
        prices: [...(item.prices || [])].sort((a, b) => a.date.localeCompare(b.date)),
      }))
      .filter((item) => item.ticker && item.prices.length >= 2);
    const latestDate = series
      .flatMap((item) => item.prices.map((point) => parseDate(point.date)))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!latestDate) return { chartData: [], tableRows: [] as TableRow[], series };
    const start = periodStartDate(period, latestDate);
    const dateMap = new Map<string, Record<string, string | number>>();
    const tableRows: TableRow[] = [];
    for (const item of series) {
      const prices = slicePricesForPeriod(item.prices, start);
      const startPrice = prices[0]?.close ?? null;
      const endPrice = prices[prices.length - 1]?.close ?? null;
      const returnPct = startPrice && endPrice ? (endPrice / startPrice - 1) * 100 : null;
      tableRows.push({ ...item, startPrice, endPrice, returnPct });
      if (!startPrice) continue;
      for (const point of prices) {
        const row = dateMap.get(point.date) || { date: point.date };
        row[item.ticker] = (point.close / startPrice - 1) * 100;
        dateMap.set(point.date, row);
      }
    }
    return {
      chartData: Array.from(dateMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date))),
      tableRows: tableRows.sort((a, b) => {
        if (a.returnPct === null && b.returnPct === null) return a.ticker.localeCompare(b.ticker);
        if (a.returnPct === null) return 1;
        if (b.returnPct === null) return -1;
        return b.returnPct - a.returnPct;
      }),
      series,
    };
  }, [data, period]);

  const lineColor = (idx: number) => {
    const palette = [
      tokens["--chart-series-4"],
      tokens["--chart-series-2"],
      tokens["--chart-series-3"],
      tokens["--chart-bear"],
      tokens["--chart-series-6"],
      tokens["--chart-series-1"],
    ].filter(Boolean);
    return palette[idx % palette.length] || tokens["--chart-axis"];
  };
  const colorByTicker = new Map(comparison.series.map((item, idx) => [item.ticker, lineColor(idx)]));

  return (
    <div className="min-w-0 px-4 py-5 sm:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--text-muted)]">Compare</p>
          <h1 className="font-display text-2xl text-[color:var(--text-primary)]">Stock Comparison</h1>
        </div>
        <div className="text-xs text-[color:var(--text-muted)]">{tickers.length}/{MAX_TICKERS} tickers</div>
      </header>

      <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-stretch">
          <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
              Add stocks
            </p>
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <TickerSearch value={selected} onChange={(entry) => setSelected(entry)} />
              </div>
              <button
                type="button"
                onClick={() => addTicker(selected)}
                disabled={!selected || tickers.length >= MAX_TICKERS}
                className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-[color:var(--accent)] bg-black/20 px-4 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--accent)] transition hover:bg-[color:var(--accent)] hover:text-[color:var(--text-on-accent)] disabled:cursor-not-allowed disabled:border-[color:var(--border-subtle)] disabled:text-[color:var(--text-disabled)] lg:w-40"
              >
                <Plus size={16} strokeWidth={2.4} />
                Add Ticker
              </button>
            </div>
          </div>
          <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
              Financial download
            </p>
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
              <div
                className="grid h-12 min-w-0 flex-1 grid-cols-3 rounded-lg border border-[color:var(--border-subtle)] bg-black/20 p-1"
                aria-label="Financial statement period"
              >
                {FINANCIAL_DOWNLOAD_PERIODS.map((option) => {
                  const active = financialDownloadPeriod === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setFinancialDownloadPeriod(option.key)}
                      className={`rounded-md px-2 text-xs font-semibold transition ${
                        active
                          ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                          : "text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={downloadFinancials}
                disabled={!tickers.length || downloadingFinancials}
                className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--text-on-accent)] transition hover:bg-[color:var(--accent-hover)] disabled:cursor-not-allowed disabled:border-[color:var(--border-subtle)] disabled:bg-black/20 disabled:text-[color:var(--text-disabled)] lg:w-56"
              >
                {downloadingFinancials ? (
                  <Loader2 size={18} strokeWidth={2.4} className="animate-spin" />
                ) : downloadStatus?.tone === "success" ? (
                  <Check size={18} strokeWidth={2.4} />
                ) : (
                  <Download size={18} strokeWidth={2.4} />
                )}
                Download Financials
              </button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {tickers.map((ticker) => (
            <span
              key={ticker}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5 font-mono text-xs font-semibold text-[color:var(--text-secondary)]"
            >
              {ticker}
              <button
                type="button"
                onClick={() => removeTicker(ticker)}
                aria-label={`Remove ${ticker}`}
                className="rounded-md p-0.5 text-[color:var(--text-muted)] hover:bg-white/5 hover:text-[color:var(--text-primary)]"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        {downloadStatus ? (
          <p
            className={`mt-3 rounded-lg border bg-black/25 px-3 py-2 text-xs ${
              downloadStatus.tone === "success"
                ? "border-[color:var(--success)] text-[color:var(--success)]"
                : "border-[color:var(--danger)] text-[color:var(--danger)]"
            }`}
          >
            {downloadStatus.message}
          </p>
        ) : null}
        {data?.not_found?.length ? (
          <p className="mt-3 rounded-lg border border-[color:var(--danger)] bg-black/25 px-3 py-2 text-xs text-[color:var(--danger)]">
            Couldn&apos;t find {data.not_found.join(", ")} after checking Yahoo. That ticker may be delisted, mistyped, or using a different exchange suffix.
          </p>
        ) : error ? (
          <p className="mt-3 rounded-lg border border-[color:var(--danger)] bg-black/25 px-3 py-2 text-xs text-[color:var(--danger)]">
            {error}
          </p>
        ) : null}
      </section>

      <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[color:var(--text-primary)]">
            <GitCompareArrows size={17} className="text-[color:var(--accent)]" />
            <h2 className="font-display text-lg">Return Chart</h2>
            {loading ? <Loader2 size={14} className="animate-spin text-[color:var(--text-muted)]" /> : null}
          </div>
          <div className="flex max-w-full flex-wrap gap-1">
            {PERIODS.map((option) => {
              const active = option.key === period;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setPeriod(option.key)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                    active
                      ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                      : "border-white/10 bg-black/25 text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="hib-chart h-[28rem] min-h-[20rem] min-w-0">
          {comparison.series.length >= 1 ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
              <RechartsLineChart data={comparison.chartData} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens["--chart-grid"]} />
                <XAxis
                  dataKey="date"
                  minTickGap={30}
                  tick={{ fill: tokens["--chart-axis"], fontSize: 11 }}
                  tickFormatter={(value) => String(value).slice(5)}
                />
                <YAxis
                  width={58}
                  tick={{ fill: tokens["--chart-axis"], fontSize: 11 }}
                  tickFormatter={(value) => formatReturn(Number(value))}
                />
                <Tooltip content={<ChartTooltip />} wrapperStyle={{ outline: "none" }} />
                <ReferenceLine y={0} stroke={tokens["--chart-current"]} strokeWidth={2.4} ifOverflow="extendDomain" />
                {comparison.series.map((item, idx) => (
                  <Line
                    key={item.ticker}
                    type="monotone"
                    dataKey={item.ticker}
                    name={item.ticker}
                    stroke={lineColor(idx)}
                    strokeWidth={idx === 0 ? 3 : 2}
                    strokeDasharray={idx >= 6 ? "6 4" : undefined}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </RechartsLineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-black/25 p-4 text-center text-sm text-[color:var(--text-muted)]">
              {loading ? "Loading comparison..." : "Add tickers to start comparing."}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">Comparison Table</h2>
          <p className="text-xs text-[color:var(--text-muted)]">Sorted by {period} return</p>
        </div>
        <div className="hib-market-table-wrap">
          <table className="hib-market-table min-w-[145rem] table-fixed">
            <colgroup>
              <col className="w-[4rem]" />
              <col className="w-[14rem]" />
              <col className="w-[7rem]" />
              <col className="w-[8rem]" />
              <col className="w-[8rem]" />
              <col className="w-[9rem]" />
              <col className="w-[6rem]" />
              <col className="w-[6rem]" />
              <col className="w-[5rem]" />
              <col className="w-[6rem]" />
              <col className="w-[6rem]" />
              <col className="w-[7rem]" />
              <col className="w-[7rem]" />
              <col className="w-[7rem]" />
              <col className="w-[7rem]" />
              <col className="w-[5rem]" />
              <col className="w-[6rem]" />
              <col className="w-[6rem]" />
              <col className="w-[7rem]" />
              <col className="w-[7rem]" />
              <col className="w-[10rem]" />
            </colgroup>
            <thead>
              <tr>
                <th className="hib-market-table-head">Rank</th>
                <th className="hib-market-table-head">Company</th>
                <th className="hib-market-table-head">Return</th>
                <th className="hib-market-table-head">Market Cap</th>
                <th className="hib-market-table-head">EV</th>
                <th className="hib-market-table-head">Net Cash / Debt</th>
                <th className="hib-market-table-head">P/E</th>
                <th className="hib-market-table-head">Forward P/E</th>
                <th className="hib-market-table-head">EV/Sales</th>
                <th className="hib-market-table-head">EV/EBITDA</th>
                <th className="hib-market-table-head">P/FCF</th>
                <th className="hib-market-table-head">Rev Growth</th>
                <th className="hib-market-table-head">EPS Growth</th>
                <th className="hib-market-table-head">Gross Margin</th>
                <th className="hib-market-table-head">Op Margin</th>
                <th className="hib-market-table-head">Net Margin</th>
                <th className="hib-market-table-head">ROE</th>
                <th className="hib-market-table-head">Current Ratio</th>
                <th className="hib-market-table-head">Debt / Equity</th>
                <th className="hib-market-table-head">Dividend</th>
                <th className="hib-market-table-head">Target Upside</th>
              </tr>
            </thead>
            <tbody>
              {comparison.tableRows.map((row, idx) => {
                const fundamentals = row.fundamentals || {};
                const tickerColor = colorByTicker.get(row.ticker);
                return (
                  <tr key={row.ticker}>
                    <td className="hib-market-table-cell font-mono text-xs">#{idx + 1}</td>
                    <td className="hib-market-table-cell min-w-0">
                      <span
                        style={tickerColor ? ({ "--series-color": tickerColor } as CSSProperties) : undefined}
                        className="hib-series-label block truncate font-mono font-semibold"
                      >
                        {row.ticker}
                      </span>
                      <span className="block truncate text-[color:var(--text-muted)]">
                        {fundamentals.company_name || row.company_name || row.exchange || "Company"}
                      </span>
                    </td>
                    <td className="hib-market-table-cell font-mono font-semibold">
                      <span className={returnTone(row.returnPct)}>{formatReturn(row.returnPct)}</span>
                    </td>
                    <td className="hib-market-table-cell font-mono">{formatLarge(fundamentals.market_cap)}</td>
                    <td className="hib-market-table-cell font-mono">{formatLarge(fundamentals.enterprise_value)}</td>
                    <td className="hib-market-table-cell font-mono">{formatLarge(fundamentals.net_cash_debt)}</td>
                    <td className="hib-market-table-cell font-mono">{formatRatio(fundamentals.trailing_pe)}</td>
                    <td className="hib-market-table-cell font-mono">{formatRatio(fundamentals.forward_pe)}</td>
                    <td className="hib-market-table-cell font-mono">{formatRatio(fundamentals.ev_sales)}</td>
                    <td className="hib-market-table-cell font-mono">{formatRatio(fundamentals.ev_ebitda)}</td>
                    <td className="hib-market-table-cell font-mono">{formatRatio(fundamentals.p_fcf)}</td>
                    <td className="hib-market-table-cell font-mono">
                      <span className={returnTone(numeric(fundamentals.revenue_growth))}>
                        {formatPercentValue(fundamentals.revenue_growth)}
                      </span>
                    </td>
                    <td className="hib-market-table-cell font-mono">
                      <span className={returnTone(numeric(fundamentals.earnings_growth))}>
                        {formatPercentValue(fundamentals.earnings_growth)}
                      </span>
                    </td>
                    <td className="hib-market-table-cell font-mono">{formatPercentValue(fundamentals.gross_margin)}</td>
                    <td className="hib-market-table-cell font-mono">{formatPercentValue(fundamentals.operating_margin)}</td>
                    <td className="hib-market-table-cell font-mono">{formatPercentValue(fundamentals.profit_margin)}</td>
                    <td className="hib-market-table-cell font-mono">{formatPercentValue(fundamentals.roe)}</td>
                    <td className="hib-market-table-cell font-mono">{formatRatio(fundamentals.current_ratio)}</td>
                    <td className="hib-market-table-cell font-mono">{formatRatio(fundamentals.debt_to_equity)}</td>
                    <td className="hib-market-table-cell font-mono">{formatPercentValue(fundamentals.dividend_yield)}</td>
                    <td className="hib-market-table-cell whitespace-nowrap pr-4 font-mono">
                      <span className={returnTone(numeric(fundamentals.target_upside))}>
                        {formatPercentValue(fundamentals.target_upside)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
