"use client";

import { Activity, BadgeDollarSign, Building2, CalendarDays, Factory, Gauge, History, Info, RefreshCw, TrendingUp } from "lucide-react";

import { ReportChipRow } from "@/components/dashboard-chrome";
import type { ReportListItem } from "@/lib/dashboard-types";
import type { YahooqueryInfo } from "@/lib/dashboard-server";

type ReturnsMap = {
  "1D"?: number | null;
  "1W"?: number | null;
  "1M"?: number | null;
  "3M"?: number | null;
  "6M"?: number | null;
  "1Y"?: number | null;
  "3Y"?: number | null;
  "5Y"?: number | null;
};

type MetricCard = {
  label: string;
  value: unknown;
  kind?: "currency" | "ratio" | "percent" | "plain";
  note?: string;
};

const RETURN_COLUMNS = ["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;

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

const ANALYST_CARD_MAP: MetricCard[] = [
  { label: "Target Mean", value: "targetMeanPrice", kind: "currency" },
  { label: "Target Median", value: "targetMedianPrice", kind: "currency" },
  { label: "Analysts", value: "numberOfAnalystOpinions", kind: "plain" },
];

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value: unknown): string {
  const n = num(value);
  if (n === null) return "N/A";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtValue(value: unknown, kind: MetricCard["kind"] = "plain", currency = "USD"): string {
  const n = num(value);
  if (n === null) {
    const text = String(value ?? "").trim();
    return text || "N/A";
  }
  if (kind === "percent") return `${(n * 100).toFixed(1)}%`;
  if (kind === "ratio") return n.toFixed(Math.abs(n) >= 100 ? 1 : 2);
  if (kind === "currency") {
    if (Math.abs(n) >= 1_000_000_000_000) return `${currency} ${(n / 1_000_000_000_000).toFixed(2)}T`;
    if (Math.abs(n) >= 1_000_000_000) return `${currency} ${(n / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`;
    return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function toneClass(value: unknown): string {
  const n = num(value);
  if (n === null || Math.abs(n) <= 1e-9) return "text-[color:var(--text-primary)]";
  return n > 0 ? "text-[color:var(--success)]" : "text-[color:var(--danger)]";
}

function metricToneClass(card: MetricCard): string {
  const n = num(card.value);
  if (n === null || Math.abs(n) <= 1e-9) return "text-[color:var(--text-primary)]";
  const label = card.label.toLowerCase();
  const isGrowthOrReturn = label.includes("growth") || label === "roa" || label === "roe" || label.includes("return");
  if (isGrowthOrReturn) return n > 0 ? "text-[color:var(--success)]" : "text-[color:var(--danger)]";
  if (label.includes("margin")) return n < 0 ? "text-[color:var(--danger)]" : "text-[color:var(--text-primary)]";
  return "text-[color:var(--text-primary)]";
}

function dateLabel(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "N/A";
  return raw.slice(0, 10);
}

function rowsFromInfo(info: YahooqueryInfo): Array<Record<string, unknown>> {
  const rows = info.valuation_measures?.rows;
  return Array.isArray(rows) ? rows : [];
}

function latestMultiple(info: YahooqueryInfo): Record<string, unknown> {
  return info.valuation_measures?.latest || {};
}

function analystData(info: YahooqueryInfo): Record<string, unknown> {
  return info.financial_data || {};
}

function liveQuote(info: YahooqueryInfo): Record<string, unknown> {
  return info.live_quote || {};
}

function profileValue(value: unknown): string {
  const text = String(value || "").trim();
  return text || "Not classified";
}

function MetricTile({ card, currency }: { card: MetricCard; currency: string }) {
  return (
    <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">{card.label}</p>
      <p className={`mt-2 font-mono text-lg font-semibold ${metricToneClass(card)}`}>
        {fmtValue(card.value, card.kind, currency)}
      </p>
      {card.note ? <p className="mt-2 text-xs leading-relaxed text-[color:var(--text-secondary)]">{card.note}</p> : null}
    </article>
  );
}

function PricePerformance({ rows }: { rows: ReturnsMap }) {
  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
        <TrendingUp size={15} />
        Price Performance
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4 xl:grid-cols-8">
        {RETURN_COLUMNS.map((key) => {
          const value = rows?.[key];
          return (
            <div key={key} className="hib-perf-cell rounded-md bg-[color:var(--surface)] px-2 py-1.5">
              <span className="block text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">{key}</span>
              <span className={`mt-1 block text-sm font-semibold ${toneClass(value)}`}>
                {typeof value === "number" && Number.isFinite(value) ? pct(value) : "N/A"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export type InfoClientProps = {
  ticker: string;
  info: YahooqueryInfo;
  returnsPct: ReturnsMap;
  liveCurrentPrice: number | null;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

export function InfoClient({
  ticker,
  info,
  returnsPct,
  liveCurrentPrice,
  reportsForTicker,
  resolvedReportId,
}: InfoClientProps) {
  const rows = rowsFromInfo(info);
  const latest = latestMultiple(info);
  const analyst = analystData(info);
  const quote = liveQuote(info);
  const profile = info.company_profile || {};
  const currency = String(
    quote.currency || quote.financialCurrency || analyst.financialCurrency || (ticker.endsWith(".TA") ? "ILS" : "USD"),
  ).toUpperCase();
  const recommendation = analyst.recommendationKey
    ? String(analyst.recommendationKey).replace(/_/g, " ")
    : "N/A";
  const status = String(info.status || "").toLowerCase();
  const multipleCards = MULTIPLE_MAP.map((item) => {
    const liveKey = LIVE_QUOTE_MULTIPLE_KEYS[item.key];
    const liveValue = liveKey ? quote[liveKey] : undefined;
    return {
      label: item.label,
      value: liveValue ?? latest[item.key],
      kind: item.kind,
      note: liveKey && liveValue !== undefined
        ? "Live quote"
        : item.key in (info.valuation_measures?.recent_average || {})
          ? `Recent avg ${fmtValue(info.valuation_measures?.recent_average?.[item.key], item.kind, currency)}`
          : undefined,
    };
  });
  const analystCards = ANALYST_CARD_MAP.map((item) => ({
    label: item.label,
    value: analyst[String(item.value)],
    kind: item.kind,
  }));

  return (
    <div className="space-y-5">
      <ReportChipRow ticker={ticker} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="inline-flex items-center gap-2 font-display text-2xl text-[color:var(--text-primary)]">
              <Info size={19} className="text-[color:var(--accent)]" />
              Information
            </h1>
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
              {ticker} - live market data and provider-reported valuation multiples
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile card={{ label: "Live Price", value: liveCurrentPrice ?? quote.currentPrice ?? quote.regularMarketPrice, kind: "currency" }} currency={currency} />
            <MetricTile card={{ label: "Currency", value: currency, kind: "plain" }} currency={currency} />
            <MetricTile card={{ label: "Wall St. Consensus", value: recommendation, kind: "plain" }} currency={currency} />
            <MetricTile card={{ label: "Data Rows", value: rows.length, kind: "plain" }} currency={currency} />
          </div>
        </div>
        {status !== "success" ? (
          <p className="mt-4 rounded-xl border border-[color:var(--warning)] bg-[color:var(--surface)] p-3 text-sm text-[color:var(--warning)]">
            {info.error || "Yahooquery data is not available right now."}
          </p>
        ) : null}
      </header>

      <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
              <Building2 size={15} />
              Company Classification
            </h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Yahoo Finance classification used by the screeners and refreshed with this Info view.
            </p>
          </div>
          <span className="rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
            YahooQuery asset profile
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <article className="group rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 transition hover:border-[color:var(--border-strong)]">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] text-[color:var(--accent)]">
                <Building2 size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Sector</p>
                <p className="mt-1 break-words text-lg font-semibold text-[color:var(--text-primary)]">
                  {profileValue(profile.sector)}
                </p>
              </div>
            </div>
          </article>
          <article className="group rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 transition hover:border-[color:var(--border-strong)]">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] text-[color:var(--info)]">
                <Factory size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Industry</p>
                <p className="mt-1 break-words text-lg font-semibold text-[color:var(--text-primary)]">
                  {profileValue(profile.industry)}
                </p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <PricePerformance rows={returnsPct} />

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
                <BadgeDollarSign size={15} />
                Valuation Multiples
              </h2>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                Latest preferred row: {dateLabel(latest.asOfDate)} / {String(latest.periodType || "N/A")}
              </p>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                Provider-reported snapshot; compare like-for-like periods and treat unavailable or non-positive values as N/A.
              </p>
            </div>
            <RefreshCw size={15} className="text-[color:var(--text-muted)]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {multipleCards.map((card) => (
              <MetricTile key={card.label} card={card} currency={currency} />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
            <Gauge size={15} />
            Analyst Snapshot
          </h2>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            Consensus targets and coverage only. Operating metrics belong in the Financials tab.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {analystCards.map((card) => (
              <MetricTile key={card.label} card={card} currency={currency} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
              <History size={15} />
              Multiple History
            </h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">Historical yahooquery valuation rows, newest first.</p>
          </div>
          <p className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
            <CalendarDays size={13} />
            {info.generated_at ? `Fetched ${dateLabel(info.generated_at)}` : "Live fetch"}
          </p>
        </div>
        <div className="overflow-auto rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)]">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Period</th>
                {MULTIPLE_MAP.slice(2).map((metric) => (
                  <th key={metric.key} className="px-3 py-2 text-right font-medium">{metric.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice().reverse().slice(0, 14).map((row, idx) => (
                <tr key={`${row.asOfDate}-${row.periodType}-${idx}`} className="border-b border-[color:var(--border-subtle)] last:border-b-0">
                  <td className="px-3 py-2 font-mono text-[color:var(--text-primary)]">{dateLabel(row.asOfDate)}</td>
                  <td className="px-3 py-2 text-[color:var(--text-secondary)]">{String(row.periodType || "N/A")}</td>
                  {MULTIPLE_MAP.slice(2).map((metric) => (
                    <td key={`${idx}-${metric.key}`} className="px-3 py-2 text-right font-mono text-[color:var(--text-primary)]">
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
      </section>

      <p className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
        <Activity size={13} />
        This tab is deterministic live yahooquery data. No LLM is used here.
      </p>
    </div>
  );
}
