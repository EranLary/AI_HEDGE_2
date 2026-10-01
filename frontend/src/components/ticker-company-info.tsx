"use client";

import {
  Activity,
  BadgeDollarSign,
  Building2,
  CalendarDays,
  Factory,
  Gauge,
  History,
  RefreshCw,
} from "lucide-react";

import type { YahooqueryInfo } from "@/lib/dashboard-server";

type MetricCard = {
  label: string;
  value: unknown;
  kind?: "currency" | "ratio" | "plain";
  note?: string;
};

const MULTIPLE_MAP: Array<{ key: string; label: string; kind: "currency" | "ratio" }> = [
  { key: "MarketCap", label: "Market Cap", kind: "currency" },
  { key: "EnterpriseValue", label: "Enterprise Value", kind: "currency" },
  { key: "PeRatio", label: "P/E", kind: "ratio" },
  { key: "ForwardPeRatio", label: "Forward P/E", kind: "ratio" },
  { key: "PegRatio", label: "PEG", kind: "ratio" },
  { key: "PbRatio", label: "P/B", kind: "ratio" },
  { key: "PsRatio", label: "P/S", kind: "ratio" },
  { key: "EnterprisesValueRevenueRatio", label: "EV/Revenue", kind: "ratio" },
  { key: "EnterprisesValueEBITDARatio", label: "EV/EBITDA", kind: "ratio" },
];

const LIVE_QUOTE_MULTIPLE_KEYS: Record<string, string> = {
  MarketCap: "marketCap",
  EnterpriseValue: "enterpriseValue",
};

const ANALYST_CARD_MAP: Array<{ key: string; label: string; kind: MetricCard["kind"] }> = [
  { key: "recommendationKey", label: "Wall St. Rating", kind: "plain" },
  { key: "targetMeanPrice", label: "Target Mean", kind: "currency" },
  { key: "targetMedianPrice", label: "Target Median", kind: "currency" },
  { key: "numberOfAnalystOpinions", label: "Analysts", kind: "plain" },
];

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtValue(value: unknown, kind: MetricCard["kind"] = "plain", currency = "USD"): string {
  const numeric = num(value);
  if (numeric === null) {
    const text = String(value ?? "").trim();
    return text || "N/A";
  }
  if (kind === "ratio") return numeric.toFixed(Math.abs(numeric) >= 100 ? 1 : 2);
  if (kind === "currency") {
    if (Math.abs(numeric) >= 1_000_000_000_000) return `${currency} ${(numeric / 1_000_000_000_000).toFixed(2)}T`;
    if (Math.abs(numeric) >= 1_000_000_000) return `${currency} ${(numeric / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(numeric) >= 1_000_000) return `${currency} ${(numeric / 1_000_000).toFixed(2)}M`;
    return `${currency} ${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function dateLabel(value: unknown): string {
  const raw = String(value || "").trim();
  return raw ? raw.slice(0, 10) : "N/A";
}

function profileValue(value: unknown): string {
  const text = String(value || "").trim();
  return text || "Not classified";
}

function displayRating(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "N/A";
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function LoadingTile() {
  return (
    <div className="animate-pulse rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4">
      <div className="h-2.5 w-20 rounded bg-[color:var(--border-strong)]" />
      <div className="mt-3 h-5 w-36 rounded bg-[color:var(--border-subtle)]" />
    </div>
  );
}

function MetricTile({ card, currency }: { card: MetricCard; currency: string }) {
  return (
    <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3.5 transition hover:border-[color:var(--border-strong)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">{card.label}</p>
      <p className="mt-2 break-words font-mono text-lg font-semibold text-[color:var(--text-primary)]">
        {card.label === "Wall St. Rating" ? displayRating(card.value) : fmtValue(card.value, card.kind, currency)}
      </p>
      {card.note ? <p className="mt-2 text-xs leading-relaxed text-[color:var(--text-secondary)]">{card.note}</p> : null}
    </article>
  );
}

export function CompanyClassification({
  profile,
}: {
  profile: {
    sector: string | null;
    industry: string | null;
    source: string | null;
    updated_at: string | null;
  } | null;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)]">
      <div className="border-b border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
              <Building2 size={15} className="text-[color:var(--accent)]" />
              Company Classification
            </h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">The company&apos;s market identity at a glance.</p>
          </div>
          <span
            title={profile?.source ? `Source: ${profile.source}` : undefined}
            className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]"
          >
            {profile?.updated_at ? `Saved ${dateLabel(profile.updated_at)}` : "Saved ticker profile"}
          </span>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 transition hover:border-[color:var(--border-strong)]">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] text-[color:var(--accent)]">
              <Building2 size={19} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Sector</p>
              <p className="mt-1 break-words text-lg font-semibold text-[color:var(--text-primary)]">
                {profileValue(profile?.sector)}
              </p>
            </div>
          </div>
        </article>
        <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 transition hover:border-[color:var(--border-strong)]">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] text-[color:var(--info)]">
              <Factory size={19} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Industry</p>
              <p className="mt-1 break-words text-lg font-semibold text-[color:var(--text-primary)]">
                {profileValue(profile?.industry)}
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

export function CompanyMarketDetails({
  ticker,
  info,
  loading,
}: {
  ticker: string;
  info: YahooqueryInfo | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4 sm:p-5">
        <div className="h-4 w-52 animate-pulse rounded bg-[color:var(--border-strong)]" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => <LoadingTile key={index} />)}
        </div>
      </section>
    );
  }

  const currentInfo = info || { ticker, status: "unavailable" };
  const rows = Array.isArray(currentInfo.valuation_measures?.rows) ? currentInfo.valuation_measures.rows : [];
  const latest = currentInfo.valuation_measures?.latest || {};
  const analyst = currentInfo.financial_data || {};
  const quote = currentInfo.live_quote || {};
  const currency = String(
    quote.currency || quote.financialCurrency || analyst.financialCurrency || (ticker.endsWith(".TA") ? "ILS" : "USD"),
  ).toUpperCase();
  const multipleCards = MULTIPLE_MAP.map((item) => {
    const liveKey = LIVE_QUOTE_MULTIPLE_KEYS[item.key];
    const liveValue = liveKey ? quote[liveKey] : undefined;
    return {
      label: item.label,
      value: liveValue ?? latest[item.key],
      kind: item.kind,
      note: liveKey && liveValue !== undefined
        ? "Live quote"
        : item.key in (currentInfo.valuation_measures?.recent_average || {})
          ? `Recent avg ${fmtValue(currentInfo.valuation_measures?.recent_average?.[item.key], item.kind, currency)}`
          : undefined,
    };
  });
  const analystCards = ANALYST_CARD_MAP.map((item) => ({
    label: item.label,
    value: analyst[item.key],
    kind: item.kind,
  }));
  const status = String(currentInfo.status || "").toLowerCase();

  return (
    <section className="space-y-4 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--border-subtle)] pb-4">
        <div>
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
            <Activity size={15} className="text-[color:var(--accent)]" />
            Company Market Data
          </h2>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            Live market context and provider-reported valuation history for {ticker}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
          <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-1">{currency}</span>
          <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-1">
            {rows.length} history rows
          </span>
          <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-1">
            {currentInfo.generated_at ? `Fetched ${dateLabel(currentInfo.generated_at)}` : "Live provider data"}
          </span>
        </div>
      </div>

      {status !== "success" ? (
        <p className="rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-sm text-[color:var(--warning)]">
          {currentInfo.error || "Company market data is not available right now."}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
                <BadgeDollarSign size={15} />
                Valuation Multiples
              </h3>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                Latest preferred row: {dateLabel(latest.asOfDate)} / {String(latest.periodType || "N/A")}
              </p>
            </div>
            <RefreshCw size={15} className="shrink-0 text-[color:var(--text-muted)]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {multipleCards.map((card) => <MetricTile key={card.label} card={card} currency={currency} />)}
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4">
          <h3 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
            <Gauge size={15} />
            Analyst Snapshot
          </h3>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">Consensus targets, rating, and analyst coverage.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {analystCards.map((card) => <MetricTile key={card.label} card={card} currency={currency} />)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
              <History size={15} />
              Multiple History
            </h3>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">Provider valuation rows, newest first.</p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
            <CalendarDays size={13} />
            Up to 14 observations
          </span>
        </div>

        <div className="space-y-3 md:hidden">
          {rows.slice().reverse().slice(0, 14).map((row, index) => (
            <article key={`${row.asOfDate}-${row.periodType}-${index}-mobile`} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-sm font-semibold text-[color:var(--text-primary)]">{dateLabel(row.asOfDate)}</p>
                <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                  {String(row.periodType || "N/A")}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                {MULTIPLE_MAP.slice(2).map((metric) => (
                  <div key={`${index}-${metric.key}-mobile`}>
                    <p className="text-[9px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{metric.label}</p>
                    <p className="mt-0.5 font-mono text-sm text-[color:var(--text-primary)]">
                      {fmtValue(row[metric.key], metric.kind, currency)}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="hidden overflow-auto rounded-xl border border-[color:var(--border-subtle)] md:block">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] text-[color:var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Period</th>
                {MULTIPLE_MAP.slice(2).map((metric) => (
                  <th key={metric.key} className="px-3 py-2 text-right font-medium">{metric.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice().reverse().slice(0, 14).map((row, index) => (
                <tr key={`${row.asOfDate}-${row.periodType}-${index}`} className="border-b border-[color:var(--border-subtle)] last:border-b-0">
                  <td className="px-3 py-2 font-mono text-[color:var(--text-primary)]">{dateLabel(row.asOfDate)}</td>
                  <td className="px-3 py-2 text-[color:var(--text-secondary)]">{String(row.periodType || "N/A")}</td>
                  {MULTIPLE_MAP.slice(2).map((metric) => (
                    <td key={`${index}-${metric.key}`} className="px-3 py-2 text-right font-mono text-[color:var(--text-primary)]">
                      {fmtValue(row[metric.key], metric.kind, currency)}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={MULTIPLE_MAP.length} className="px-3 py-4 text-[color:var(--text-muted)]">
                    No valuation-measure rows returned.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {!rows.length ? <p className="py-4 text-center text-sm text-[color:var(--text-muted)] md:hidden">No valuation-measure rows returned.</p> : null}
      </div>

      <p className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
        <Activity size={13} />
        Deterministic live Yahoo data; no LLM is used for this section.
      </p>
    </section>
  );
}
