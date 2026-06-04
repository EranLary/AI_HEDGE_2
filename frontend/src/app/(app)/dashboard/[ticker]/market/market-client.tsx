"use client";

import {
  BarChart3,
  Building2,
  ChartNoAxesColumn,
  Layers3,
  Network,
  ShieldAlert,
  Store,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

type MarketSectionMeta = {
  key?: string;
  eyebrow: string;
  icon: LucideIcon;
  wide?: boolean;
};

const SECTION_META: MarketSectionMeta[] = [
  {
    key: "market definition",
    eyebrow: "Market Scope",
    icon: Store,
  },
  {
    key: "ranked competitor map",
    eyebrow: "Strategic Overlap",
    icon: Network,
  },
  {
    key: "financial comparison",
    eyebrow: "Reported Metrics",
    icon: BarChart3,
    wide: true,
  },
  {
    key: "product and customer overlap",
    eyebrow: "Product Surface",
    icon: Layers3,
  },
  {
    key: "competitive positioning",
    eyebrow: "Relative Position",
    icon: Building2,
  },
  {
    key: "market structure and risks",
    eyebrow: "Pressure Points",
    icon: ShieldAlert,
  },
  {
    key: "valuation implications",
    eyebrow: "Investor Read-Through",
    icon: Target,
    wide: true,
  },
];

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

function sectionMeta(title: string) {
  const normalized = title.trim().toLowerCase();
  return SECTION_META.find((item) => item.key ? normalized.includes(item.key) : false) || {
    eyebrow: "Market Intelligence",
    icon: ChartNoAxesColumn,
    wide: false,
  };
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

function MarkdownPanel({ title, text, emptyText }: { title: string; text: string; emptyText: string }) {
  const body = markdownText(text);
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 break-words text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
        <SmallCopyButton text={body} label={`Copy ${title}`} />
      </div>
      {body ? (
        <MarketMarkdown text={body} />
      ) : (
        <p className="text-sm text-zinc-500">{emptyText}</p>
      )}
    </section>
  );
}

function MarketReviewSections({ text }: { text: string }) {
  const sections = splitMarketSections(text);
  if (!sections.length) {
    return (
      <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Peer Market Review</h2>
        <p className="mt-3 text-sm text-zinc-500">No competitor market review was stored for this report.</p>
      </section>
    );
  }

  return (
    <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
            Peer Market Review
          </p>
          <h2 className="font-display text-xl text-[color:var(--text-primary)]">Competitive Landscape</h2>
        </div>
        <SmallCopyButton text={text} label="Copy Peer Market Review" />
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {sections.map((section, idx) => {
          const meta = sectionMeta(section.title);
          const Icon = meta.icon;
          return (
            <article
              key={`${section.title}-${idx}`}
              className={[
                "min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4",
                meta.wide ? "lg:col-span-2" : "",
              ].join(" ")}
            >
              <div className="mb-3 flex min-w-0 items-start gap-3">
                <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
                  <Icon size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
                    {meta.eyebrow}
                  </p>
                  <h3 className="break-words font-display text-lg text-[color:var(--text-primary)]">{section.title}</h3>
                </div>
              </div>
              <MarketMarkdown text={section.body} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function competitorRows(payload: MarketReviewPayload | undefined) {
  return Array.isArray(payload?.competitors) ? payload.competitors.slice(0, 5) : [];
}

function MarketDataComparison({ market, ticker }: { market: MarketReviewPayload; ticker: string }) {
  const original = market.original_company || {};
  const originalInfo = infoRecord(original.info);
  const rows = [
    {
      rank: "Own",
      ticker: original.ticker || ticker,
      company_name: original.company_name || ticker,
      info: originalInfo,
    },
    ...competitorRows(market).map((row) => ({
      rank: row.rank ? `#${row.rank}` : "Peer",
      ticker: row.ticker || "",
      company_name: row.company_name || "",
      info: infoRecord(row.info),
    })),
  ].filter((row) => row.ticker || row.company_name || Object.keys(row.info).length);

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
                    <span className="block font-mono font-semibold">{row.ticker || "-"}</span>
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
  const marketAgentMarkdown = markdownText(market.market_agent_markdown);
  const status = String(market.status || "unavailable");
  const hasReview = Boolean(reviewMarkdown || marketAgentMarkdown || rows.length);
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
        <section className="mb-4 min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Closest Public Peers</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row, idx) => (
              <article key={`${row.ticker || "competitor"}-${idx}`} className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-mono text-sm font-semibold text-zinc-100">{row.ticker || "N/A"}</p>
                    <p className="break-words text-sm text-zinc-300">{row.company_name || "Unnamed company"}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                    #{row.rank || idx + 1}
                  </span>
                </div>
                {row.similarity_rationale ? (
                  <p className="mt-2 break-words text-xs leading-relaxed text-zinc-400">{row.similarity_rationale}</p>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4">
        <MarketDataComparison market={market} ticker={ticker} />
        <MarketReviewSections text={reviewMarkdown} />
        <MarkdownPanel
          title="Market Analysis"
          text={marketAgentMarkdown}
          emptyText="No current market-agent text was found for this report."
        />
      </div>
    </div>
  );
}
