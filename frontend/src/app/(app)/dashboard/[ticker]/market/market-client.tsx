"use client";

import { Store } from "lucide-react";
import ReactMarkdown from "react-markdown";
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

function MarkdownPanel({ title, text, emptyText }: { title: string; text: string; emptyText: string }) {
  const body = markdownText(text);
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
        <SmallCopyButton text={body} label={`Copy ${title}`} />
      </div>
      {body ? (
        <div className="hib-markdown text-sm leading-relaxed text-zinc-200">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">{emptyText}</p>
      )}
    </section>
  );
}

function competitorRows(payload: MarketReviewPayload | undefined) {
  return Array.isArray(payload?.competitors) ? payload.competitors.slice(0, 5) : [];
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
    <div>
      <ReportChipRow ticker={ticker} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{ticker}</p>
          <h1 className="font-display text-2xl text-zinc-100">Market</h1>
          <p className="mt-1 text-sm text-zinc-400">{marketName}</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300">
          <Store size={14} />
          <span className="font-semibold uppercase tracking-[0.14em]">{status}</span>
        </div>
      </header>

      {!hasReview ? (
        <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Market Review</h2>
          <p className="mt-3 text-sm text-zinc-500">
            This report was generated before the competitor market review agent was added. Run a fresh report to build this tab.
          </p>
          {error ? <p className="mt-2 text-xs text-zinc-500">{error}</p> : null}
        </section>
      ) : null}

      {rows.length ? (
        <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Closest Public Companies</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row, idx) => (
              <article key={`${row.ticker || "competitor"}-${idx}`} className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-zinc-100">{row.ticker || "N/A"}</p>
                    <p className="text-sm text-zinc-300">{row.company_name || "Unnamed company"}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                    #{row.rank || idx + 1}
                  </span>
                </div>
                {row.similarity_rationale ? (
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">{row.similarity_rationale}</p>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4">
        <MarkdownPanel
          title="Competitor Market Review"
          text={reviewMarkdown}
          emptyText="No competitor market review was stored for this report."
        />
        <MarkdownPanel
          title="Current Market Agent"
          text={marketAgentMarkdown}
          emptyText="No current market-agent text was found for this report."
        />
      </div>
    </div>
  );
}
