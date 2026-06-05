"use client";

import {
  BarChart3,
  Building2,
  Info,
  Store,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ReportChipRow } from "@/components/dashboard-chrome";
import { SmallCopyButton } from "@/components/hedge-dashboard";
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

function normalizeTableMissingValues(text: string): string {
  return String(text || "")
    .split("\n")
    .map((line) => (
      line.includes("|")
        ? line.replace(/(\|\s*)(?:n\/a|N\/A)(\s*(?=\|))/g, "$1-$2")
        : line
    ))
    .join("\n");
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

function infoRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

type MarketSection = {
  title: string;
  body: string;
};

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
  a({ node: _node, ...props }) {
    return <a className="font-semibold text-[color:var(--info)] underline-offset-4 hover:underline" {...props} />;
  },
};

type ComparisonRow = {
  rank: string;
  ticker: string;
  company_name: string;
  info: Record<string, unknown>;
  description: string;
  rationale?: string;
  confidence?: string | number | null;
};

function splitMarketSections(text: string): MarketSection[] {
  const src = markdownText(text).replace(/\r\n/g, "\n");
  if (!src) return [];

  const lines = src.split("\n");
  const sections: MarketSection[] = [];
  let currentTitle = "Market Review";
  let currentBody: string[] = [];
  let sawSection = false;

  const flush = () => {
    const body = currentBody.join("\n").trim();
    if (body || currentTitle !== "Market Review") {
      sections.push({ title: currentTitle, body });
    }
    currentBody = [];
  };

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      if (sawSection || currentBody.join("\n").trim()) flush();
      currentTitle = match[1].trim();
      sawSection = true;
      continue;
    }
    currentBody.push(line);
  }
  flush();

  return sections.filter((section) => section.body || section.title);
}

function MarketMarkdown({ text }: { text: string }) {
  const normalized = normalizeTableMissingValues(text);
  return (
    <div className="hib-markdown hib-market-markdown min-w-0 max-w-full text-sm leading-relaxed text-zinc-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={marketMarkdownComponents}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

function compactText(value: unknown, maxLength = 190): string {
  const clean = markdownText(value).replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}...`;
}

function companyDescription(info: Record<string, unknown>, fallback: unknown): string {
  return compactText(
    info.longBusinessSummary ||
      info.businessSummary ||
      info.description ||
      info.longName ||
      fallback,
    320
  );
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
      description: companyDescription(originalInfo, market.name_of_market),
    },
    ...competitorRows(market).map((row) => {
      const info = infoRecord(row.info);
      return {
        rank: row.rank ? `#${row.rank}` : "Peer",
        ticker: String(row.ticker || ""),
        company_name: String(row.company_name || ""),
        info,
        description: companyDescription(info, row.similarity_rationale || row.overlap_notes),
        rationale: compactText(row.similarity_rationale || row.overlap_notes, 150),
        confidence: row.confidence,
      };
    }),
  ].filter((row) => row.ticker || row.company_name || Object.keys(row.info).length);
}

function InfoHint({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        title={text}
        aria-label={label}
        className="ml-1 inline-flex size-5 items-center justify-center rounded-full border border-white/10 bg-black/25 text-[color:var(--info)]"
      >
        <Info size={12} />
      </button>
    </span>
  );
}

function sectionRank(title: string): number {
  const normalized = title.toLowerCase();
  if (normalized.includes("financial comparison")) return 0;
  if (normalized.includes("ranked competitor")) return 1;
  if (normalized.includes("product") || normalized.includes("customer")) return 2;
  if (normalized.includes("valuation")) return 3;
  if (normalized.includes("competitive positioning")) return 4;
  return 9;
}

function extractMarkdownTables(body: string): string[] {
  const lines = markdownText(body).replace(/\r\n/g, "\n").split("\n");
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

function stripMarkdownTables(body: string): string {
  return markdownText(body)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.includes("|"))
    .join("\n");
}

function cleanIdea(value: string): string {
  return compactText(
    value
      .replace(/^[-*]\s+/, "")
      .replace(/^#+\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
    170
  );
}

function extractKeyIdeas(sections: MarketSection[]): string[] {
  const ranked = [...sections].sort((a, b) => sectionRank(a.title) - sectionRank(b.title));
  const ideas: string[] = [];

  for (const section of ranked) {
    const text = stripMarkdownTables(section.body);
    const candidates = text
      .split(/\n+|(?<=\.)\s+/)
      .map(cleanIdea)
      .filter((line) => line.length >= 40 && !line.toLowerCase().startsWith("n/a"));

    for (const candidate of candidates) {
      if (!ideas.some((idea) => idea.toLowerCase() === candidate.toLowerCase())) {
        ideas.push(candidate);
      }
      if (ideas.length >= 4) return ideas;
    }
  }

  return ideas;
}

function extractImportantTables(sections: MarketSection[]) {
  return [...sections]
    .sort((a, b) => sectionRank(a.title) - sectionRank(b.title))
    .flatMap((section) => extractMarkdownTables(section.body).slice(0, 1).map((table) => ({
      title: section.title,
      table,
    })))
    .slice(0, 2);
}

function PeerOverviewTable({ market, ticker }: { market: MarketReviewPayload; ticker: string }) {
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
            Closest Public Comparables
          </h2>
        </div>
      </div>

      <div className="hib-market-table-wrap">
        <table className="hib-market-table">
          <thead>
            <tr>
              <th className="hib-market-table-head">Rank</th>
              <th className="hib-market-table-head">Company</th>
              <th className="hib-market-table-head">Why It Matters</th>
              <th className="hib-market-table-head">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map((row, idx) => (
              <tr key={`${row.ticker || row.company_name}-${idx}`}>
                <td className="hib-market-table-cell font-mono text-xs">{row.rank}</td>
                <td className="hib-market-table-cell">
                  <span className="font-mono font-semibold">
                    {row.ticker || "-"}
                    <InfoHint label={`About ${row.company_name || row.ticker}`} text={row.description} />
                  </span>
                  <span className="block text-[color:var(--text-muted)]">{row.company_name || "Unnamed company"}</span>
                </td>
                <td className="hib-market-table-cell">{row.rationale || "-"}</td>
                <td className="hib-market-table-cell font-mono">{row.confidence ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MarketReviewEssentials({ text }: { text: string }) {
  const sections = splitMarketSections(text);
  if (!sections.length) {
    return (
      <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Peer Market Review</h2>
        <p className="mt-3 text-sm text-zinc-500">No competitor market review was stored for this report.</p>
      </section>
    );
  }

  const ideas = extractKeyIdeas(sections);
  const tables = extractImportantTables(sections);

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
            Condensed Review
          </p>
          <h2 className="font-display text-xl text-[color:var(--text-primary)]">Key Read-Throughs</h2>
        </div>
        <SmallCopyButton text={text} label="Copy Full Peer Market Review" />
      </div>

      {ideas.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {ideas.map((idea, idx) => (
            <p key={`${idea}-${idx}`} className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3 text-sm leading-relaxed text-[color:var(--text-secondary)]">
              {idea}
            </p>
          ))}
        </div>
      ) : null}

      {tables.length ? (
        <div className="mt-4 grid gap-4">
          {tables.map((item, idx) => (
            <div key={`${item.title}-${idx}`} className="min-w-0">
              <h3 className="mb-2 break-words text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
                {item.title}
              </h3>
              <MarketMarkdown text={item.table} />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function competitorRows(payload: MarketReviewPayload | undefined) {
  return Array.isArray(payload?.competitors) ? payload.competitors.slice(0, 5) : [];
}

function MarketDataComparison({ market, ticker }: { market: MarketReviewPayload; ticker: string }) {
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
            Peer Comparison
          </p>
          <h2 className="break-words font-display text-lg text-[color:var(--text-primary)]">
            Original Company vs Public Peers
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
              <th className="hib-market-table-head">Revenue</th>
              <th className="hib-market-table-head">Rev Growth</th>
              <th className="hib-market-table-head">Gross Margin</th>
              <th className="hib-market-table-head">EBITDA Margin</th>
              <th className="hib-market-table-head">Net Margin</th>
              <th className="hib-market-table-head">P/E</th>
              <th className="hib-market-table-head">EV/Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const info = row.info;
              return (
                <tr key={`${row.ticker || row.company_name}-${idx}`}>
                  <td className="hib-market-table-cell font-mono text-xs">{row.rank}</td>
                  <td className="hib-market-table-cell">
                    <span className="font-mono font-semibold">
                      {row.ticker || "-"}
                      <InfoHint label={`About ${row.company_name || row.ticker}`} text={row.description} />
                    </span>
                    <span className="block text-[color:var(--text-muted)]">{row.company_name || "Unnamed company"}</span>
                  </td>
                  <td className="hib-market-table-cell font-mono">{formatLarge(info.marketCap)}</td>
                  <td className="hib-market-table-cell font-mono">{formatLarge(info.enterpriseValue)}</td>
                  <td className="hib-market-table-cell font-mono">{formatLarge(info.totalRevenue)}</td>
                  <td className="hib-market-table-cell font-mono">{formatPercent(info.revenueGrowth)}</td>
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

export function MarketClient({ ticker, data, reportsForTicker, resolvedReportId }: MarketClientProps) {
  const market = data.market_review || {};
  const rows = competitorRows(market);
  const reviewMarkdown = markdownText(market.review_markdown);
  const status = String(market.status || "unavailable");
  const hasReview = Boolean(reviewMarkdown || rows.length);
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

      {rows.length ? (
        <PeerOverviewTable market={market} ticker={ticker} />
      ) : null}

      <div className="grid gap-4">
        <MarketDataComparison market={market} ticker={ticker} />
        <MarketReviewEssentials text={reviewMarkdown} />
      </div>
    </div>
  );
}
