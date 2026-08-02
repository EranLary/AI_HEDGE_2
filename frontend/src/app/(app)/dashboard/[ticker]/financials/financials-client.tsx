"use client";

import { AlertTriangle, BadgeDollarSign, FileSpreadsheet, Info } from "lucide-react";
import { useMemo } from "react";

import { ReportChipRow } from "@/components/dashboard-chrome";
import { SmallCopyButton } from "@/components/hedge-dashboard";
import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";

type FinancialPeriod = {
  key?: string;
  label?: string;
  date?: string;
  period_type?: string;
};

type FinancialRow = {
  metric?: string;
  kind?: string;
  values?: Record<string, number | null>;
  quality?: string;
  note?: string;
};

type CurrentMetric = {
  metric?: string;
  kind?: string;
  value?: number | null;
  quality?: string;
  note?: string;
};

const EMPTY_PERIODS: FinancialPeriod[] = [];
const EMPTY_ROWS: FinancialRow[] = [];
const EMPTY_CURRENT_METRICS: CurrentMetric[] = [];

const BALANCE_METRICS = new Set([
  "Total Assets",
  "Customers / Accounts Receivable",
  "Inventory",
  "Liquid Assets: Cash, Cash Equivalents, and Short-Term Investments",
  "Working Capital",
  "Total Liabilities",
  "Total Shareholders' Equity",
  "Total Debt: Short-Term and Long-Term",
  "Net Liquidity: Liquid Assets Less Debt",
  "Equity-to-Assets Ratio",
]);

const SNAPSHOT_METRICS = new Set([
  "Market Capitalization",
  "Enterprise Value (EV)",
  "Price-to-Book Ratio (P/B)",
  "Price-to-Earnings Ratio (P/E)",
]);

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || "").trim()).filter(Boolean);
}

function fmtValue(value: unknown, kind?: string): string {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const type = String(kind || "").toLowerCase();
  if (type === "percent") return `${(n * 100).toFixed(1)}%`;
  if (type === "ratio") return n.toFixed(2);
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function qualityClass(value?: string): string {
  const q = String(value || "").toLowerCase();
  if (q === "reported") return "border-[color:var(--success)] text-[color:var(--success)]";
  if (q === "derived" || q === "mixed") return "border-[color:var(--info)] text-[color:var(--info)]";
  if (q === "unavailable") return "border-[color:var(--border-strong)] text-[color:var(--text-muted)]";
  return "border-[color:var(--border-subtle)] text-[color:var(--text-secondary)]";
}

function periodChip(period: FinancialPeriod): string {
  const raw = String(period.label || period.key || "").trim();
  const dateYear = String(period.date || "").match(/^(\d{4})-\d{2}-\d{2}/)?.[1] || "";
  const dateMonth = Number(String(period.date || "").match(/^\d{4}-(\d{2})-\d{2}/)?.[1] || "");
  if (String(period.period_type || "").toLowerCase() === "annual") {
    const yearFromDate = dateYear ? Number(dateYear) - (dateMonth === 1 ? 1 : 0) : null;
    const year = yearFromDate || Number(raw.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "");
    return year ? `FY ${year}` : raw || "FY";
  }
  const quarter = raw.match(/\bQ\s*([1-4])\b/i)?.[1] || "";
  const rawYear = raw.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "";
  if (quarter && rawYear) return `Q${quarter} ${rawYear}`;
  if (quarter && dateYear && quarter === "4" && Number.isFinite(dateMonth) && dateMonth <= 3) {
    return `Q4 ${Number(dateYear) - 1}`;
  }
  if (quarter && dateYear) return `Q${quarter} ${dateYear}`;
  if (quarter) return `Q${quarter}`;
  return raw || String(period.date || period.key || "");
}

function normalizePeriodLabels(periods: FinancialPeriod[]): FinancialPeriod[] {
  let prevQuarter: number | null = null;
  let prevYear: number | null = null;
  return periods.map((period) => {
    if (String(period.period_type || "").toLowerCase() !== "quarterly") return period;
    const raw = String(period.label || period.key || "").trim();
    const quarter = Number(raw.match(/\bQ\s*([1-4])\b/i)?.[1] || "");
    const dateYearRaw = String(period.date || "").match(/^(\d{4})-\d{2}-\d{2}/)?.[1] || "";
    const dateYear = dateYearRaw ? Number(dateYearRaw) : null;
    if (!Number.isFinite(quarter) || quarter < 1 || quarter > 4) {
      prevQuarter = null;
      prevYear = null;
      return period;
    }
    let displayYear = dateYear;
    if (prevQuarter !== null && prevYear !== null && quarter === prevQuarter + 1) {
      displayYear = prevYear;
    } else if (prevQuarter === 4 && prevYear !== null && quarter === 1) {
      displayYear = dateYear || prevYear + 1;
    }
    prevQuarter = quarter;
    prevYear = displayYear;
    return {
      ...period,
      label: displayYear ? `Q${quarter} ${displayYear}` : `Q${quarter}`,
    };
  });
}

function isAnnualPeriod(period: FinancialPeriod): boolean {
  return String(period.period_type || "").toLowerCase() === "annual";
}

function dateParts(date?: string): string[] {
  const parts = String(date || "").split("-");
  return parts.length === 3 ? parts : [String(date || "")];
}

function tableCopyText(title: string, periods: FinancialPeriod[], rows: FinancialRow[]): string {
  const header = ["Metric", ...periods.map((p) => `${periodChip(p)} ${p.date || ""}`.trim()), "Quality", "Note"];
  const lines = [title, header.join("\t")];
  for (const row of rows) {
    lines.push([
      row.metric || "",
      ...periods.map((period) => fmtValue(row.values?.[String(period.key || "")], row.kind)),
      row.quality || "",
      row.note || "",
    ].join("\t"));
  }
  return lines.join("\n");
}

function snapshotCopyText(metrics: CurrentMetric[]): string {
  const lines = ["Current Snapshot", ["Metric", "Value", "Quality", "Note"].join("\t")];
  for (const metric of metrics) {
    lines.push([metric.metric || "", fmtValue(metric.value, metric.kind), metric.quality || "", metric.note || ""].join("\t"));
  }
  return lines.join("\n");
}

function FinancialTable({
  title,
  subtitle,
  periods,
  rows,
}: {
  title: string;
  subtitle: string;
  periods: FinancialPeriod[];
  rows: FinancialRow[];
}) {
  if (!rows.length) return null;
  const copyText = tableCopyText(title, periods, rows);

  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">{title}</h2>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">{subtitle}</p>
        </div>
        <SmallCopyButton text={copyText} label={`Copy ${title}`} />
      </div>
      <div className="overflow-auto rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)]">
        <table className="w-full min-w-[1180px] table-fixed text-sm">
          <colgroup>
            <col className="w-[260px]" />
            {periods.map((period) => (
              <col key={period.key} className="w-[112px]" />
            ))}
            <col className="w-[116px]" />
            <col className="w-[340px]" />
          </colgroup>
          <thead className="border-b border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">
            <tr>
              <th className="bg-[color:var(--surface-elevated)] px-3 py-3 text-left font-medium sm:sticky sm:left-0 sm:z-10">Metric</th>
              {periods.map((period) => (
                <th
                  key={period.key}
                  className={`px-3 py-3 text-right align-bottom font-medium ${
                    isAnnualPeriod(period) ? "border-x border-[color:var(--border-strong)] bg-[color:var(--surface-elevated)]" : ""
                  }`}
                >
                  <span className={`block text-base leading-5 text-[color:var(--text-primary)] ${isAnnualPeriod(period) ? "font-semibold" : ""}`}>
                    {periodChip(period).replace(/\s+/g, " ")}
                  </span>
                  <span className="mt-1 block font-mono text-[11px] leading-4 text-[color:var(--text-muted)]">
                    {dateParts(period.date).map((part) => (
                      <span key={`${period.key}-${part}`} className="block">
                        {part}
                      </span>
                    ))}
                  </span>
                </th>
              ))}
              <th className="px-3 py-3 text-left align-bottom font-medium">Quality</th>
              <th className="px-3 py-3 text-left align-bottom font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.metric}-${idx}`} className="border-b border-[color:var(--border-subtle)] last:border-b-0">
                <td className="bg-[color:var(--surface-elevated)] px-3 py-2 font-medium text-[color:var(--text-primary)] sm:sticky sm:left-0 sm:z-10">
                  {row.metric}
                </td>
                {periods.map((period) => (
                  <td
                    key={`${row.metric}-${period.key}`}
                    className={`px-3 py-2 text-right font-mono text-[color:var(--text-primary)] ${
                      isAnnualPeriod(period) ? "border-x border-[color:var(--border-strong)] bg-[color:var(--surface-elevated)] font-semibold" : ""
                    }`}
                  >
                    {fmtValue(row.values?.[String(period.key || "")], row.kind)}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${qualityClass(row.quality)}`}>
                    {row.quality || "mixed"}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs leading-relaxed text-[color:var(--text-secondary)]">{row.note || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export type FinancialsClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

export function FinancialsClient({
  ticker,
  data,
  reportsForTicker,
  resolvedReportId,
}: FinancialsClientProps) {
  const upper = ticker;
  const payload = data.financials || {};
  const status = String(payload.status || "").toLowerCase();
  const analysis = payload.analysis || {};
  const rawPeriods = Array.isArray(analysis.periods) ? (analysis.periods as FinancialPeriod[]) : EMPTY_PERIODS;
  const periods = normalizePeriodLabels(rawPeriods);
  const rows = Array.isArray(analysis.rows) ? (analysis.rows as FinancialRow[]) : EMPTY_ROWS;
  const currentMetrics = Array.isArray(analysis.current_metrics) ? (analysis.current_metrics as CurrentMetric[]) : EMPTY_CURRENT_METRICS;
  const takeaways = asList(analysis.key_takeaways);
  const warnings = asList(analysis.warnings);
  const currency = String(analysis.currency || data.header?.original_financial_currency || data.header?.currency || "USD").toUpperCase();
  const unit = String(analysis.unit || "raw");
  const hasTable = status === "success" && periods.length > 0 && rows.length > 0;

  const { snapshotMetrics, incomeRows, balanceRows, copyAllText } = useMemo(() => {
    const snapshotFromRows: CurrentMetric[] = rows
      .filter((row) => SNAPSHOT_METRICS.has(String(row.metric || "")))
      .map((row) => {
        const values = periods.map((period) => row.values?.[String(period.key || "")]).filter((value) => Number.isFinite(Number(value)));
        const last = values.length ? Number(values[values.length - 1]) : null;
        return { metric: row.metric, kind: row.kind, value: last, quality: row.quality, note: row.note };
      });
    const snapshot = currentMetrics.length ? currentMetrics : snapshotFromRows;
    const filteredRows = rows.filter((row) => !SNAPSHOT_METRICS.has(String(row.metric || "")));
    const balance = filteredRows.filter((row) => BALANCE_METRICS.has(String(row.metric || "")));
    const income = filteredRows.filter((row) => !BALANCE_METRICS.has(String(row.metric || "")));
    const copyBlocks = [
      snapshot.length ? snapshotCopyText(snapshot) : "",
      tableCopyText("Income and Cash Flow", periods, income),
      tableCopyText("Balance Sheet", periods, balance),
    ].filter(Boolean);
    return {
      snapshotMetrics: snapshot,
      incomeRows: income,
      balanceRows: balance,
      copyAllText: copyBlocks.join("\n\n"),
    };
  }, [currentMetrics, periods, rows]);

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="inline-flex items-center gap-2 font-display text-2xl text-[color:var(--text-primary)]">
              <FileSpreadsheet size={18} className="text-[color:var(--accent)]" />
              Financials
            </h1>
            <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
              {upper} - original reporting currency
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasTable ? <SmallCopyButton text={copyAllText} label="Copy all financial tables" /> : null}
            <div className="rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-right">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Currency</p>
              <p className="font-mono text-lg font-semibold text-[color:var(--text-primary)]">{currency}</p>
              <p className="text-[11px] text-[color:var(--text-muted)]">{unit}</p>
            </div>
          </div>
        </div>
      </header>

      {!hasTable ? (
        <section className="rounded-2xl border border-red-500/35 bg-red-500/10 p-4">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-red-100">
            <AlertTriangle size={14} />
            Financials table is not available for this report.
          </p>
          {payload.error ? <p className="mt-2 text-xs text-red-200/90">{payload.error}</p> : null}
        </section>
      ) : (
        <div className="space-y-5">
          {takeaways.length ? (
            <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">
                <BadgeDollarSign size={14} />
                What matters most
              </h2>
              <ol className="mt-3 grid gap-3 lg:grid-cols-2">
                {takeaways.slice(0, 10).map((item, idx) => (
                  <li key={`takeaway-${idx}`} className="flex gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--border-strong)] font-mono text-xs text-[color:var(--text-secondary)]">
                      {idx + 1}
                    </span>
                    <span className="text-sm leading-relaxed text-[color:var(--text-primary)]">{item}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {snapshotMetrics.length ? (
            <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--text-secondary)]">Current Snapshot</h2>
                  <p className="mt-1 text-sm text-[color:var(--text-muted)]">Latest market values, separate from historical statement periods.</p>
                </div>
                <SmallCopyButton text={snapshotCopyText(snapshotMetrics)} label="Copy current snapshot" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {snapshotMetrics.map((metric) => (
                  <article key={metric.metric} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">{metric.metric}</p>
                    <p className="mt-2 font-mono text-lg font-semibold text-[color:var(--text-primary)]">{fmtValue(metric.value, metric.kind)}</p>
                    <p className="mt-2 text-xs leading-relaxed text-[color:var(--text-secondary)]">{metric.note || ""}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <FinancialTable title={analysis.title || "Income and Cash Flow"} subtitle={`Values stay in ${currency}`} periods={periods} rows={incomeRows} />
          <FinancialTable title="Balance Sheet" subtitle="Assets, liabilities, equity, debt, and liquidity." periods={periods} rows={balanceRows} />

          {warnings.length ? (
            <section className="rounded-2xl border border-[color:var(--warning)] bg-[color:var(--surface-elevated)] p-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--warning)]">Caveats</h2>
              <ul className="mt-3 space-y-2 text-sm text-[color:var(--text-secondary)]">
                {warnings.map((item, idx) => (
                  <li key={`warning-${idx}`} className="flex gap-2">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--warning)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)]">
            <Info size={13} />
            Missing data is shown as a dash; a displayed 0 means the source value or formula is actually zero.
          </p>
        </div>
      )}
    </div>
  );
}
