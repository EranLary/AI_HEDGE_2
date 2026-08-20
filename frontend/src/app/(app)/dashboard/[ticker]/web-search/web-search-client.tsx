"use client";

import { Clock3, ExternalLink, FileSearch, Globe2, Link2, Newspaper, Search, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ReportChipRow } from "@/components/dashboard-chrome";
import { SmallCopyButton } from "@/components/hedge-dashboard";
import type { DashboardPayload, ReportListItem, WebSearchSource } from "@/lib/dashboard-types";

type WebSearchClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function dateLabel(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return "Date unavailable";
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return raw.slice(0, 10);
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function safeExternalUrl(value: unknown): string {
  const raw = cleanText(value);
  return /^https?:\/\//i.test(raw) ? raw : "";
}

const markdownComponents: Components = {
  a({ node, href, children, ...props }) {
    void node;
    const safeHref = safeExternalUrl(href);
    if (!safeHref) return <span>{children}</span>;
    return (
      <a
        {...props}
        href={safeHref}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-baseline gap-1 font-medium text-[color:var(--accent)] underline decoration-[color:var(--border-strong)] underline-offset-2 hover:text-[color:var(--accent-hover)]"
      >
        <span>{children}</span>
        <ExternalLink size={11} aria-hidden />
      </a>
    );
  },
  table({ node, ...props }) {
    void node;
    return (
      <div className="overflow-auto rounded-xl border border-[color:var(--border-subtle)]">
        <table className="w-full min-w-[44rem] text-sm" {...props} />
      </div>
    );
  },
  th({ node, ...props }) {
    void node;
    return <th className="border-b border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2 text-left text-[color:var(--text-secondary)]" {...props} />;
  },
  td({ node, ...props }) {
    void node;
    return <td className="border-b border-[color:var(--border-subtle)] px-3 py-2 align-top text-[color:var(--text-secondary)]" {...props} />;
  },
};

function SourceCard({ source }: { source: WebSearchSource }) {
  const href = safeExternalUrl(source.url);
  const queryIds = Array.isArray(source.query_ids) ? source.query_ids.filter(Boolean) : [];
  return (
    <article className="flex min-h-48 flex-col justify-between rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 transition hover:border-[color:var(--border-strong)]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
            {source.kind === "news" ? <Newspaper size={11} /> : <Globe2 size={11} />}
            {cleanText(source.kind) || "web"}
          </span>
          {queryIds.map((id) => (
            <span key={id} className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1 font-mono text-[10px] text-[color:var(--text-muted)]">
              {id.toUpperCase()}
            </span>
          ))}
        </div>
        <h3 className="text-sm font-semibold leading-snug text-[color:var(--text-primary)]">
          {cleanText(source.title) || "Untitled source"}
        </h3>
        <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-[color:var(--text-secondary)]">
          {cleanText(source.snippet) || "Open the source for the full context."}
        </p>
      </div>
      <div className="mt-4 border-t border-[color:var(--border-subtle)] pt-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[color:var(--text-muted)]">
          <span>{cleanText(source.publisher) || "Web source"}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1"><Clock3 size={10} />{dateLabel(source.published_at)}</span>
        </p>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)] hover:text-[color:var(--accent-hover)]"
          >
            Open source <ExternalLink size={12} />
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function WebSearchClient({ ticker, data, reportsForTicker, resolvedReportId }: WebSearchClientProps) {
  const webSearch = data.web_search || {};
  const queries = Array.isArray(webSearch.queries) ? webSearch.queries : [];
  const sources = Array.isArray(webSearch.sources) ? webSearch.sources : [];
  const errors = Array.isArray(webSearch.errors) ? webSearch.errors.filter(Boolean) : [];
  const report = cleanText(webSearch.report_markdown);
  const status = cleanText(webSearch.status || "unavailable").toLowerCase();
  const hasResearch = Boolean(queries.length || report || sources.length);

  return (
    <div className="space-y-5">
      <ReportChipRow ticker={ticker} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-5">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] text-[color:var(--accent)]">
              <Globe2 size={21} />
            </div>
            <div>
              <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--accent)]">
                <Sparkles size={11} /> Complementary Research
              </p>
              <h1 className="font-display text-2xl text-[color:var(--text-primary)]">Web Search</h1>
              <p className="mt-1 max-w-3xl text-sm text-[color:var(--text-secondary)]">
                Research gaps selected after the core analysis, then investigated across current web and news sources before valuation.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2">
              <p className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Queries</p>
              <p className="mt-1 font-mono text-lg font-semibold text-[color:var(--text-primary)]">{queries.length}</p>
            </div>
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2">
              <p className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Sources</p>
              <p className="mt-1 font-mono text-lg font-semibold text-[color:var(--text-primary)]">{sources.length}</p>
            </div>
            <div className="col-span-2 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2 sm:col-span-1">
              <p className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Status</p>
              <p className={`mt-1 text-sm font-semibold uppercase ${status === "success" ? "text-[color:var(--success)]" : "text-[color:var(--warning)]"}`}>
                {status}
              </p>
            </div>
          </div>
        </div>
      </header>

      {!hasResearch ? (
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] text-[color:var(--text-muted)]">
              <FileSearch size={18} />
            </div>
            <div>
              <h2 className="font-display text-lg text-[color:var(--text-primary)]">No web-search research in this report</h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                This report was generated before the Web Search stage was added. The tab remains available and will populate after a fresh analysis.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {queries.length ? (
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
                <Search size={15} /> Research Query Map
              </h2>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">Up to six additive questions selected from gaps in the completed analysis.</p>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {queries.map((query, index) => (
              <article key={query.id || `${query.query}-${index}`} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] font-mono text-xs font-semibold text-[color:var(--accent)]">
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-sm font-semibold leading-snug text-[color:var(--text-primary)]">{cleanText(query.query)}</h3>
                      {query.focus ? (
                        <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                          {query.focus}
                        </span>
                      ) : null}
                    </div>
                    {query.research_goal ? <p className="mt-2 text-xs leading-relaxed text-[color:var(--text-secondary)]">{query.research_goal}</p> : null}
                    {query.valuation_relevance ? (
                      <p className="mt-2 border-l-2 border-[color:var(--accent)] pl-3 text-xs leading-relaxed text-[color:var(--text-muted)]">
                        {query.valuation_relevance}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {report ? (
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border-subtle)] pb-4">
            <div>
              <h2 className="inline-flex items-center gap-2 font-display text-xl text-[color:var(--text-primary)]">
                <Sparkles size={17} className="text-[color:var(--accent)]" /> Research Brief
              </h2>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                {webSearch.generated_at ? `Generated ${dateLabel(webSearch.generated_at)}` : "Generated with the report"}
              </p>
            </div>
            <SmallCopyButton text={report} label="Copy web research" iconOnly />
          </div>
          <div className="hib-markdown text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{report}</ReactMarkdown>
          </div>
        </section>
      ) : null}

      {sources.length ? (
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
          <div className="mb-4">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
              <Link2 size={15} /> Source Library
            </h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">The exact links supplied to the research agent.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sources.map((source, index) => <SourceCard key={`${source.url}-${index}`} source={source} />)}
          </div>
        </section>
      ) : null}

      {errors.length && status !== "success" ? (
        <section className="rounded-2xl border border-[color:var(--warning)] bg-[color:var(--surface-elevated)] p-4 text-sm text-[color:var(--warning)]">
          <p className="inline-flex items-center gap-2 font-semibold"><FileSearch size={15} /> Web search did not complete</p>
          <p className="mt-2 text-xs leading-relaxed">{errors[0]}</p>
        </section>
      ) : null}
    </div>
  );
}
