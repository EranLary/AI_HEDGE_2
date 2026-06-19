"use client";

import { Activity, BadgeDollarSign, BarChart3, CalendarDays, Database, Landmark, LineChart, RefreshCw, ShieldCheck } from "lucide-react";

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

const FINANCIAL_CARD_MAP: MetricCard[] = [
  { label: "Current Price", value: "currentPrice", kind: "currency" },
  { label: "Target Mean", value: "targetMeanPrice", kind: "currency" },
  { label: "Target Median", value: "targetMedianPrice", kind: "currency" },
  { label: "Analysts", value: "numberOfAnalystOpinions", kind: "plain" },
  { label: "Revenue Growth", value: "revenueGrowth", kind: "percent" },
  { label: "Earnings Growth", value: "earningsGrowth", kind: "percent" },
  { label: "Gross Margin", value: "grossMargins", kind: "percent" },
  { label: "EBITDA Margin", value: "ebitdaMargins", kind: "percent" },
  { label: "Operating Margin", value: "operatingMargins", kind: "percent" },
  { label: "Profit Margin", value: "profitMargins", kind: "percent" },
  { label: "ROA", value: "returnOnAssets", kind: "percent" },
  { label: "ROE", value: "returnOnEquity", kind: "percent" },
  { label: "Cash", value: "totalCash", kind: "currency" },
  { label: "Debt", value: "totalDebt", kind: "currency" },
  { label: "Current Ratio", value: "currentRatio", kind: "ratio" },
  { label: "Debt / Equity", value: "debtToEquity", kind: "ratio" },
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

function financialData(info: YahooqueryInfo): Record<string, unknown> {
  return info.financial_data || {};
}

function MetricTile({ card, currency }: { card: MetricCard; currency: string }) {
  return (
    <article className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">{card.label}</p>
      <p className="mt-2 font-mono text-lg font-semibold text-[color:var(--text-primary)]">
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
        <LineChart size={15} />
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
  const finance = financialData(info);
  const currency = String(finance.financialCurrency || (ticker.endsWith(".TA") ? "ILS" : "USD")).toUpperCase();
  const recommendation = String(finance.recommendationKey || "none").replace(/_/g, " ");
  const status = String(info.status || "").toLowerCase();
  const multipleCards = MULTIPLE_MAP.map((item) => ({
    label: item.label,
    value: latest[item.key],
    kind: item.kind,
    note: item.key in (info.valuation_measures?.recent_average || {})
      ? `Recent avg ${fmtValue(info.valuation_measures?.recent_average?.[item.key], item.kind, currency)}`
      : undefined,
  }));
  const financeCards = FINANCIAL_CARD_MAP.map((item) => ({
    label: item.label,
    value: finance[String(item.value)],
    kind: item.kind,
  }));

  return (
    <div className="space-y-5">
      <ReportChipRow ticker={ticker} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="inline-flex items-center gap-2 font-display text-2xl text-[color:var(--text-primary)]">
              <Database size={19} className="text-[color:var(--accent)]" />
              Info
            </h1>
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
              {ticker} - live yahooquery profile, multiples, and market context
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile card={{ label: "Live Price", value: liveCurrentPrice ?? finance.currentPrice, kind: "currency" }} currency={currency} />
            <MetricTile card={{ label: "Currency", value: currency, kind: "plain" }} currency={currency} />
            <MetricTile card={{ label: "Recommendation", value: recommendation, kind: "plain" }} currency={currency} />
            <MetricTile card={{ label: "Data Rows", value: rows.length, kind: "plain" }} currency={currency} />
          </div>
        </div>
        {status !== "success" ? (
          <p className="mt-4 rounded-xl border border-[color:var(--warning)] bg-[color:var(--surface)] p-3 text-sm text-[color:var(--warning)]">
            {info.error || "Yahooquery data is not available right now."}
          </p>
        ) : null}
      </header>

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
            <ShieldCheck size={15} />
            Quality Snapshot
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {financeCards.slice(4, 12).map((card) => (
              <MetricTile key={card.label} card={card} currency={currency} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
          <Landmark size={15} />
          Financial Data
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {financeCards.map((card) => (
            <MetricTile key={card.label} card={card} currency={currency} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
              <BarChart3 size={15} />
              Multiple History
            </h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">Historical yahooquery valuation rows, newest first.</p>
          </div>
          <p className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
            <CalendarDays size={13} />
            {info.generated_at ? `Updated ${dateLabel(info.generated_at)}` : "Live fetch"}
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
