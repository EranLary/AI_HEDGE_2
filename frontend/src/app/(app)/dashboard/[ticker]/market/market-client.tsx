"use client";

import {
  BarChart3,
  Building2,
  Layers3,
  Store,
  TrendingUp,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ReportChipRow } from "@/components/dashboard-chrome";
import type { DashboardPayload, MarketReviewPayload, ReportListItem } from "@/lib/dashboard-types";

type MarketClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

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
        rationale: compactText(row.similarity_rationale || row.overlap_notes, 360),
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
        <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
          <Store size={14} />
          <span className="font-semibold uppercase tracking-[0.14em]">{status}</span>
        </div>
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
        <PeerStrategyTable market={market} ticker={ticker} />
        <ProductOverlapTable market={market} />
        <FinancialScaleTable market={market} ticker={ticker} />
        <MarginValuationTable market={market} ticker={ticker} />
      </div>
    </div>
  );
}
