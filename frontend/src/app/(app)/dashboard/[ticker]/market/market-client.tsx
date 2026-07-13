"use client";

import {
  BarChart3,
  Building2,
  Layers3,
  Store,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import remarkGfm from "remark-gfm";

import { ReportChipRow } from "@/components/dashboard-chrome";
import type { DashboardPayload, MarketReviewPayload, ReportListItem } from "@/lib/dashboard-types";
import { useThemeTokens } from "@/lib/theme-tokens";

type MarketClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

const RETURN_PERIODS = [
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

const RETURN_CHART_TOKENS = [
  "--chart-grid",
  "--chart-axis",
  "--chart-current",
  "--chart-series-1",
  "--chart-series-2",
  "--chart-series-4",
  "--chart-series-6",
  "--chart-bear",
] as const;

function markdownText(value: unknown): string {
  return String(value || "").trim();
}

function numeric(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatLarge(value: unknown): string {
  const n = numeric(value);
  if (n === null) return "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPercent(value: unknown): string {
  const n = numeric(value);
  if (n === null) return "-";
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

function formatMultiple(value: unknown): string {
  const n = numeric(value);
  if (n === null || n <= 0) return "-";
  return `${n.toFixed(1)}x`;
}

function formatReturn(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function returnTone(value: number | null): string {
  if (value === null) return "text-[color:var(--text-muted)]";
  if (value > 0) return "text-[color:var(--success)]";
  if (value < 0) return "text-[color:var(--danger)]";
  return "text-[color:var(--text-secondary)]";
}

function formatResemblance(value: unknown): string {
  const text = markdownText(value);
  if (!text) return "-";
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  if (n > 0 && n <= 1) return `${Math.round(n * 100)}%`;
  return `${Math.round(n)}%`;
}

function infoRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const marketMarkdownComponents: Components = {
  table({ node: _node, ...props }) {
    return (
      <div className="hib-market-table-wrap">
        <table className="hib-market-table" {...props} />
      </div>
    );
  },
  th({ node: _node, ...props }) {
    return <th className="hib-market-table-head" {...props} />;
  },
  td({ node: _node, ...props }) {
    return <td className="hib-market-table-cell" {...props} />;
  },
};

type ComparisonRow = {
  rank: string;
  ticker: string;
  company_name: string;
  info: Record<string, unknown>;
  rationale?: string;
  confidence?: string | number | null;
};

function compactText(value: unknown, maxLength = 190): string {
  const clean = markdownText(value).replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}...`;
}

function markdownSection(text: string, sectionName: string): string {
  const source = markdownText(text).replace(/\r\n/g, "\n");
  if (!source) return "";

  const target = sectionName.trim().toLowerCase();
  const lines = source.split("\n");
  const body: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (collecting) break;
      collecting = heading[1].trim().toLowerCase() === target;
      continue;
    }
    if (collecting) body.push(line);
  }

  return body.join("\n").trim();
}

function markdownTables(text: string): string[] {
  const lines = markdownText(text).replace(/\r\n/g, "\n").split("\n");
  const tables: string[] = [];
  let block: string[] = [];

  const flush = () => {
    if (block.length >= 2 && block.some((line) => /\|\s*:?-{3,}:?\s*\|/.test(line))) {
      tables.push(block.join("\n").trim());
    }
    block = [];
  };

  for (const line of lines) {
    if (line.includes("|")) {
      block.push(line);
    } else {
      flush();
    }
  }
  flush();

  return tables;
}

function buildComparisonRows(market: MarketReviewPayload, ticker: string): ComparisonRow[] {
  const original = market.original_company || {};
  const originalInfo = infoRecord(original.info);
  return [
    {
      rank: "Own",
      ticker: String(original.ticker || ticker),
      company_name: String(original.company_name || ticker),
      info: originalInfo,
    },
    ...competitorRows(market).map((row) => {
      const info = infoRecord(row.info);
      return {
        rank: row.rank ? `#${row.rank}` : "Peer",
        ticker: String(row.ticker || ""),
        company_name: String(row.company_name || ""),
        info,
        rationale: markdownText(row.similarity_rationale || row.overlap_notes),
        confidence: row.confidence,
      };
    }),
  ].filter((row) => row.ticker || row.company_name || Object.keys(row.info).length);
}

function CompanyCell({ row }: { row: ComparisonRow }) {
  return (
    <td className="hib-market-table-cell">
      <span className="font-mono font-semibold">{row.ticker || "-"}</span>
      <span className="block text-[color:var(--text-muted)]">{row.company_name || "Unnamed company"}</span>
    </td>
  );
}

type PricePoint = {
  date: string;
  close: number;
};

type ReturnSeries = {
  ticker: string;
  company_name: string;
  prices: PricePoint[];
};

type ReturnTableRow = {
  ticker: string;
  company_name: string;
  returnPct: number | null;
  latestClose: number | null;
};

type MarketReturnApiPayload = {
  status?: string;
  series?: Array<{
    ticker?: string;
    company_name?: string;
    prices?: Array<{
      date?: string;
      close?: number;
    }>;
  }>;
  error?: string;
};

function parseDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeReturnSeriesFromPayload(
  payload: MarketReturnApiPayload | undefined,
  namesByTicker: Map<string, string>,
): ReturnSeries[] {
  const raw = payload?.series;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((series) => {
      const prices = Array.isArray(series.prices)
        ? series.prices
            .map((point) => {
              const close = numeric(point.close);
              const date = markdownText(point.date);
              return close !== null && close > 0 && date ? { date, close } : null;
            })
            .filter((point): point is PricePoint => Boolean(point))
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];
      const ticker = markdownText(series.ticker).toUpperCase();
      return {
        ticker,
        company_name: markdownText(series.company_name) || namesByTicker.get(ticker) || "",
        prices,
      };
    })
    .filter((series) => series.ticker && series.prices.length >= 2);
}

function returnUniverse(market: MarketReviewPayload, ticker: string): ReturnTableRow[] {
  return buildComparisonRows(market, ticker)
    .map((row) => ({
      ticker: markdownText(row.ticker).toUpperCase(),
      company_name: markdownText(row.company_name),
      returnPct: null,
      latestClose: null,
    }))
    .filter((row, idx, rows) => row.ticker && rows.findIndex((candidate) => candidate.ticker === row.ticker) === idx)
    .slice(0, 6);
}

function periodStartDate(periodKey: string, latestDate: Date): Date {
  if (periodKey === "YTD") return new Date(latestDate.getFullYear(), 0, 1);
  const option = RETURN_PERIODS.find((item) => item.key === periodKey);
  const days = option?.days ?? 365;
  const start = new Date(latestDate);
  start.setDate(start.getDate() - days);
  return start;
}

function slicePricesForPeriod(prices: PricePoint[], start: Date): PricePoint[] {
  const filtered = prices.filter((point) => {
    const date = parseDate(point.date);
    return date ? date >= start : false;
  });
  if (filtered.length >= 2) return filtered;
  return prices.slice(-2);
}

function ReturnTooltip({
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

function MarketReturnComparison({ market, ticker }: { market: MarketReviewPayload; ticker: string }) {
  const [period, setPeriod] = useState<(typeof RETURN_PERIODS)[number]["key"]>("1Y");
  const [remotePayload, setRemotePayload] = useState<MarketReturnApiPayload | null>(null);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadError, setLoadError] = useState("");
  const tokens = useThemeTokens(RETURN_CHART_TOKENS);
  const universe = useMemo(() => returnUniverse(market, ticker), [market, ticker]);
  const namesByTicker = useMemo(
    () => new Map(universe.map((row) => [row.ticker, row.company_name])),
    [universe],
  );
  const savedSeries = useMemo(
    () => normalizeReturnSeriesFromPayload(market.return_comparison, namesByTicker),
    [market.return_comparison, namesByTicker],
  );
  const remoteSeries = useMemo(
    () => normalizeReturnSeriesFromPayload(remotePayload || undefined, namesByTicker),
    [remotePayload, namesByTicker],
  );
  const series = savedSeries.length >= 2 ? savedSeries : remoteSeries;
  const tickerList = useMemo(() => universe.map((row) => row.ticker), [universe]);
  const primaryTicker = universe[0]?.ticker || ticker.toUpperCase();

  useEffect(() => {
    if (savedSeries.length >= 2 || tickerList.length < 2) {
      setLoadState(savedSeries.length >= 2 ? "ready" : "idle");
      setLoadError("");
      return;
    }

    const controller = new AbortController();
    setLoadState("loading");
    setLoadError("");
    const qs = new URLSearchParams({ tickers: tickerList.join(",") });
    fetch(`/api/dashboard/${encodeURIComponent(ticker.toUpperCase())}/market-returns?${qs.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Market return lookup failed (${res.status})`);
        return (await res.json()) as MarketReturnApiPayload;
      })
      .then((payload) => {
        setRemotePayload(payload);
        setLoadState("ready");
        setLoadError(markdownText(payload.error));
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setRemotePayload(null);
        setLoadState("error");
        setLoadError(err.message || "Market return lookup failed.");
      });
    return () => controller.abort();
  }, [savedSeries.length, ticker, tickerList]);

  const comparison = useMemo(() => {
    const latestDates = series
      .flatMap((item) => item.prices.map((point) => parseDate(point.date)))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime());
    const latestDate = latestDates[0];
    if (!latestDate) return { chartData: [], tableRows: [], activeSeries: [] };
    const start = periodStartDate(period, latestDate);
    const dateMap = new Map<string, Record<string, string | number>>();
    const tableRows: ReturnTableRow[] = [];
    const activeSeries: ReturnSeries[] = [];

    for (const item of series) {
      const prices = slicePricesForPeriod(item.prices, start);
      const base = prices[0]?.close;
      const latest = prices[prices.length - 1]?.close;
      const returnPct = base && latest ? (latest / base - 1) * 100 : null;
      tableRows.push({
        ticker: item.ticker,
        company_name: item.company_name,
        returnPct,
        latestClose: latest ?? null,
      });
      if (!base || prices.length < 2) continue;
      activeSeries.push(item);
      for (const point of prices) {
        const row = dateMap.get(point.date) || { date: point.date };
        row[item.ticker] = (point.close / base - 1) * 100;
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
      activeSeries,
    };
  }, [period, series]);

  if (universe.length < 2) return null;

  const colorForSeries = (seriesTicker: string, idx: number) => {
    if (seriesTicker === primaryTicker) return tokens["--chart-current"] || tokens["--chart-axis"];
    const palette = [
      tokens["--chart-series-2"],
      tokens["--chart-series-4"],
      tokens["--chart-series-6"],
      tokens["--chart-bear"],
      tokens["--chart-series-1"],
    ].filter(Boolean);
    return palette[idx % palette.length] || tokens["--chart-axis"];
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
            <TrendingUp size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
              Return Comparison
            </p>
            <h2 className="break-words font-display text-lg text-[color:var(--text-primary)]">
              Market Peer Performance
            </h2>
          </div>
        </div>
        <div className="flex max-w-full flex-wrap gap-1">
          {RETURN_PERIODS.map((option) => {
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="hib-chart h-80 min-h-[18rem] min-w-0">
          {series.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={260}>
              <RechartsLineChart data={comparison.chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens["--chart-grid"]} />
                <XAxis
                  dataKey="date"
                  minTickGap={28}
                  tick={{ fill: tokens["--chart-axis"], fontSize: 11 }}
                  tickFormatter={(value) => String(value).slice(5)}
                />
                <YAxis
                  width={56}
                  tick={{ fill: tokens["--chart-axis"], fontSize: 11 }}
                  tickFormatter={(value) => formatReturn(Number(value))}
                />
                <Tooltip content={<ReturnTooltip />} wrapperStyle={{ outline: "none" }} />
                {comparison.activeSeries.map((item, idx) => (
                  <Line
                    key={item.ticker}
                    type="monotone"
                    dataKey={item.ticker}
                    name={item.ticker}
                    stroke={colorForSeries(item.ticker, idx)}
                    strokeWidth={item.ticker === primaryTicker ? 3.2 : 2}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </RechartsLineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full min-h-[18rem] items-center justify-center rounded-xl border border-white/10 bg-black/25 p-4 text-center text-sm text-[color:var(--text-muted)]">
              {loadState === "loading"
                ? "Loading market return history..."
                : loadError || "Return history is unavailable for this peer set."}
            </div>
          )}
        </div>

        <div className="hib-market-table-wrap">
          <table className="hib-market-table min-w-[14rem] table-fixed">
            <colgroup>
              <col className="w-[3rem]" />
              <col className="w-[7rem]" />
              <col className="w-[4rem]" />
            </colgroup>
            <thead>
              <tr>
                <th className="hib-market-table-head">Rank</th>
                <th className="hib-market-table-head">Ticker</th>
                <th className="hib-market-table-head">Return</th>
              </tr>
            </thead>
            <tbody>
              {(comparison.tableRows.length ? comparison.tableRows : universe).map((row, idx) => {
                const isPrimary = row.ticker === primaryTicker;
                return (
                  <tr key={row.ticker} className={isPrimary ? "bg-black/25" : undefined}>
                    <td
                      className={`hib-market-table-cell font-mono text-xs ${
                        isPrimary ? "font-bold text-[color:var(--accent)]" : ""
                      }`}
                    >
                      #{idx + 1}
                    </td>
                    <td className="hib-market-table-cell min-w-0">
                      <span
                        className={`block truncate font-mono ${
                          isPrimary ? "font-bold text-[color:var(--accent)]" : "font-semibold"
                        }`}
                      >
                        {row.ticker}
                      </span>
                      <span
                        className={`block truncate text-[color:var(--text-muted)] ${
                          isPrimary ? "font-semibold text-[color:var(--text-secondary)]" : ""
                        }`}
                      >
                        {row.company_name || "Company"}
                      </span>
                    </td>
                    <td
                      className={`hib-market-table-cell whitespace-nowrap font-mono ${
                        isPrimary ? "font-bold" : "font-semibold"
                      } ${returnTone(row.returnPct)}`}
                    >
                      {formatReturn(row.returnPct)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PeerStrategyTable({ market, ticker }: { market: MarketReviewPayload; ticker: string }) {
  const rows = buildComparisonRows(market, ticker);
  if (rows.length <= 1) return null;

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex min-w-0 items-start gap-3">
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
          <Building2 size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
            Peer Set
          </p>
          <h2 className="break-words font-display text-lg text-[color:var(--text-primary)]">
            Strategic Comparable Map
          </h2>
        </div>
      </div>

      <div className="hib-market-table-wrap">
        <table className="hib-market-table min-w-[58rem] table-fixed">
          <colgroup>
            <col className="w-[5rem]" />
            <col className="w-[14rem]" />
            <col className="w-[32rem]" />
            <col className="w-[7rem]" />
          </colgroup>
          <thead>
            <tr>
              <th className="hib-market-table-head">Rank</th>
              <th className="hib-market-table-head">Company</th>
              <th className="hib-market-table-head">
                <span className="whitespace-nowrap">Comparable Basis</span>
              </th>
              <th className="hib-market-table-head">Resemblance</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, idx) => (
              <tr key={`${row.ticker || row.company_name}-${idx}`}>
                <td className="hib-market-table-cell font-mono text-xs">{row.rank}</td>
                <CompanyCell row={row} />
                <td className="hib-market-table-cell max-w-[42rem] whitespace-normal break-words leading-relaxed">
                  {row.rationale || "-"}
                </td>
                <td className="hib-market-table-cell font-mono">{formatResemblance(row.confidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProductOverlapTable({ market }: { market: MarketReviewPayload }) {
  const section = markdownSection(String(market.review_markdown || ""), "Product And Customer Overlap");
  const tables = markdownTables(section);
  const rows = competitorRows(market).filter((row) => markdownText(row.overlap_notes));

  if (!tables.length && !rows.length) return null;

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex min-w-0 items-start gap-3">
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
          <Layers3 size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
            Product Overlap
          </p>
          <h2 className="break-words font-display text-lg text-[color:var(--text-primary)]">
            Where They Compete
          </h2>
        </div>
      </div>

      {tables.length ? (
        <div className="grid gap-3">
          {tables.slice(0, 2).map((table, idx) => (
            <div key={`product-overlap-${idx}`} className="min-w-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={marketMarkdownComponents}>
                {table}
              </ReactMarkdown>
            </div>
          ))}
        </div>
      ) : (
        <div className="hib-market-table-wrap">
          <table className="hib-market-table">
            <thead>
              <tr>
                <th className="hib-market-table-head">Company</th>
                <th className="hib-market-table-head">Product / Customer Overlap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={`${row.ticker || row.company_name}-${idx}`}>
                  <td className="hib-market-table-cell">
                    <span className="font-mono font-semibold">{row.ticker || "-"}</span>
                    <span className="block text-[color:var(--text-muted)]">{row.company_name || "Unnamed company"}</span>
                  </td>
                  <td className="hib-market-table-cell max-w-[44rem] whitespace-normal break-words leading-relaxed">
                    {compactText(row.overlap_notes, 420)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FinancialScaleTable({ market, ticker }: { market: MarketReviewPayload; ticker: string }) {
  const rows = buildComparisonRows(market, ticker);
  if (!rows.length || rows.every((row) => !Object.keys(row.info).length)) return null;

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex min-w-0 items-start gap-3">
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
          <BarChart3 size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
            Financial Scale
          </p>
          <h2 className="break-words font-display text-lg text-[color:var(--text-primary)]">
            Size And Growth
          </h2>
        </div>
      </div>

      <div className="hib-market-table-wrap">
        <table className="hib-market-table">
          <thead>
            <tr>
              <th className="hib-market-table-head">Rank</th>
              <th className="hib-market-table-head">Company</th>
              <th className="hib-market-table-head">Market Cap</th>
              <th className="hib-market-table-head">EV</th>
              <th className="hib-market-table-head">Revenue (TTM)</th>
              <th className="hib-market-table-head">Rev Growth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const info = row.info;
              return (
                <tr key={`${row.ticker || row.company_name}-${idx}`}>
                  <td className="hib-market-table-cell font-mono text-xs">{row.rank}</td>
                  <CompanyCell row={row} />
                  <td className="hib-market-table-cell font-mono">{formatLarge(info.marketCap)}</td>
                  <td className="hib-market-table-cell font-mono">{formatLarge(info.enterpriseValue)}</td>
                  <td className="hib-market-table-cell font-mono">{formatLarge(info.totalRevenue)}</td>
                  <td className="hib-market-table-cell font-mono">{formatPercent(info.revenueGrowth)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MarginValuationTable({ market, ticker }: { market: MarketReviewPayload; ticker: string }) {
  const rows = buildComparisonRows(market, ticker);
  if (!rows.length || rows.every((row) => !Object.keys(row.info).length)) return null;

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex min-w-0 items-start gap-3">
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
          <TrendingUp size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
            Profitability And Multiples
          </p>
          <h2 className="break-words font-display text-lg text-[color:var(--text-primary)]">
            Margins And Valuation
          </h2>
        </div>
      </div>

      <div className="hib-market-table-wrap">
        <table className="hib-market-table">
          <thead>
            <tr>
              <th className="hib-market-table-head">Rank</th>
              <th className="hib-market-table-head">Company</th>
              <th className="hib-market-table-head">Gross Margin (TTM)</th>
              <th className="hib-market-table-head">EBITDA Margin (TTM)</th>
              <th className="hib-market-table-head">Net Margin (TTM)</th>
              <th className="hib-market-table-head">P/E (TTM)</th>
              <th className="hib-market-table-head">EV/Revenue (TTM)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const info = row.info;
              return (
                <tr key={`${row.ticker || row.company_name}-${idx}`}>
                  <td className="hib-market-table-cell font-mono text-xs">{row.rank}</td>
                  <CompanyCell row={row} />
                  <td className="hib-market-table-cell font-mono">{formatPercent(info.grossMargins)}</td>
                  <td className="hib-market-table-cell font-mono">{formatPercent(info.ebitdaMargins)}</td>
                  <td className="hib-market-table-cell font-mono">{formatPercent(info.profitMargins)}</td>
                  <td className="hib-market-table-cell font-mono">{formatMultiple(info.trailingPE)}</td>
                  <td className="hib-market-table-cell font-mono">{formatMultiple(info.enterpriseToRevenue)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function competitorRows(payload: MarketReviewPayload | undefined) {
  return Array.isArray(payload?.competitors) ? payload.competitors.slice(0, 5) : [];
}

export function MarketClient({ ticker, data, reportsForTicker, resolvedReportId }: MarketClientProps) {
  const market = data.market_review || {};
  const rows = competitorRows(market);
  const status = String(market.status || "unavailable");
  const showStatus = status.trim().toLowerCase() !== "success";
  const hasReview = Boolean(rows.length);
  const marketName = markdownText(market.name_of_market) || "Market context";
  const error = markdownText(market.error);

  return (
    <div className="min-w-0">
      <ReportChipRow ticker={ticker} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{ticker}</p>
          <h1 className="font-display text-2xl text-zinc-100">Market</h1>
          <p className="mt-1 max-w-full break-words text-sm text-zinc-400">{marketName}</p>
        </div>
        {showStatus ? (
          <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
            <Store size={14} />
            <span className="font-semibold uppercase tracking-[0.14em]">{status}</span>
          </div>
        ) : null}
      </header>

      {!hasReview ? (
        <section className="mb-4 min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Market Review</h2>
          <p className="mt-3 text-sm text-zinc-500">
            This report was generated before the competitor market review agent was added. Run a fresh report to build this tab.
          </p>
          {error ? <p className="mt-2 text-xs text-zinc-500">{error}</p> : null}
        </section>
      ) : null}

      <div className="grid gap-4">
        <MarketReturnComparison market={market} ticker={ticker} />
        <PeerStrategyTable market={market} ticker={ticker} />
        <ProductOverlapTable market={market} />
        <FinancialScaleTable market={market} ticker={ticker} />
        <MarginValuationTable market={market} ticker={ticker} />
      </div>
    </div>
  );
}
