"use client";

import { AlertTriangle, BadgeDollarSign, FileSpreadsheet, Info } from "lucide-react";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { ReportChipRow } from "@/components/dashboard-chrome";

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

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || "").trim()).filter(Boolean);
}

function fmtValue(value: unknown, kind?: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const type = String(kind || "").toLowerCase();
  if (type === "percent") return `${(n * 100).toFixed(1)}%`;
  if (type === "ratio") return `${n.toFixed(2)}x`;
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function qualityClass(value?: string): string {
  const q = String(value || "").toLowerCase();
  if (q === "reported") return "border-emerald-400/35 text-emerald-200";
  if (q === "derived" || q === "mixed") return "border-sky-400/30 text-sky-200";
  if (q === "unavailable") return "border-zinc-500/30 text-zinc-400";
  return "border-white/10 text-zinc-300";
}

function periodChip(period: FinancialPeriod): string {
  const type = String(period.period_type || "").toLowerCase() === "annual" ? "FY" : "Q";
  return `${type} ${period.label || period.date || period.key || ""}`.replace(/^FY FY\s+/i, "FY ").replace(/^Q Q/i, "Q");
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
  const periods = Array.isArray(analysis.periods) ? (analysis.periods as FinancialPeriod[]) : [];
  const rows = Array.isArray(analysis.rows) ? (analysis.rows as FinancialRow[]) : [];
  const takeaways = asList(analysis.key_takeaways);
  const warnings = asList(analysis.warnings);
  const currency = String(analysis.currency || data.header?.original_financial_currency || data.header?.currency || "USD").toUpperCase();
  const unit = String(analysis.unit || "raw");
  const hasTable = status === "success" && periods.length > 0 && rows.length > 0;

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="inline-flex items-center gap-2 font-display text-2xl text-zinc-100">
              <FileSpreadsheet size={18} className="text-emerald-300" />
              Financials
            </h1>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              {upper} · original reporting currency
            </p>
          </div>
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-200">Currency</p>
            <p className="font-mono text-lg font-semibold text-emerald-100">{currency}</p>
            <p className="text-[11px] text-zinc-400">{unit}</p>
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
            <section className="grid gap-3 lg:grid-cols-3">
              {takeaways.slice(0, 6).map((item, idx) => (
                <article key={`takeaway-${idx}`} className="rounded-xl border border-white/10 bg-zinc-950/70 p-3">
                  <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    <BadgeDollarSign size={13} />
                    Read {idx + 1}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-100">{item}</p>
                </article>
              ))}
            </section>
          ) : null}

          <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-300">
                  {analysis.title || "Financial Statement Bridge"}
                </h2>
                {analysis.subtitle ? <p className="mt-1 text-sm text-zinc-400">{analysis.subtitle}</p> : null}
              </div>
              <p className="inline-flex items-center gap-1 text-xs text-zinc-400">
                <Info size={13} />
                Values stay in {currency}
              </p>
            </div>
            <div className="overflow-auto rounded-xl border border-white/10 bg-black/25">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="border-b border-white/10 text-zinc-400">
                  <tr>
                    <th className="sticky left-0 z-10 bg-zinc-950 px-3 py-2 text-left font-medium">Metric</th>
                    {periods.map((period) => (
                      <th key={period.key} className="px-3 py-2 text-right font-medium">
                        <span className="block text-zinc-200">{periodChip(period)}</span>
                        <span className="block text-[10px] uppercase tracking-[0.12em] text-zinc-500">{period.date}</span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left font-medium">Quality</th>
                    <th className="px-3 py-2 text-left font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`${row.metric}-${idx}`} className="border-b border-white/5 last:border-b-0">
                      <td className="sticky left-0 z-10 bg-zinc-950 px-3 py-2 font-medium text-zinc-100">
                        {row.metric}
                      </td>
                      {periods.map((period) => (
                        <td key={`${row.metric}-${period.key}`} className="px-3 py-2 text-right font-mono text-zinc-100">
                          {fmtValue(row.values?.[String(period.key || "")], row.kind)}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${qualityClass(row.quality)}`}>
                          {row.quality || "mixed"}
                        </span>
                      </td>
                      <td className="max-w-[340px] px-3 py-2 text-xs leading-relaxed text-zinc-300">{row.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {warnings.length ? (
            <section className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-100">Caveats</h2>
              <ul className="mt-3 space-y-2 text-sm text-amber-50/90">
                {warnings.map((item, idx) => (
                  <li key={`warning-${idx}`} className="flex gap-2">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-200" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
