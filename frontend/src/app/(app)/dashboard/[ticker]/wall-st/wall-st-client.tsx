"use client";

import { Activity, BarChart3, FileText, Gauge, LineChart, ListChecks, TrendingDown, TrendingUp } from "lucide-react";

import { ReportChipRow } from "@/components/dashboard-chrome";
import type { DashboardPayload, ReportListItem, WallStPayload } from "@/lib/dashboard-types";

type WallStClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function fmtNum(value: unknown, digits = 2): string {
  const n = num(value);
  if (n === null) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(digits, 2) });
}

function fmtPct(value: unknown): string {
  const n = num(value);
  if (n === null) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtLarge(value: unknown): string {
  const n = num(value);
  if (n === null) return "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return fmtNum(n, 0);
}

function fmtGrowth(value: unknown): string {
  const n = num(value);
  if (n === null) return "-";
  const pct = Math.abs(n) <= 4 ? n * 100 : n;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function toneClass(value: unknown): string {
  const n = num(value);
  if (n === null || Math.abs(n) <= 1e-9) return "text-[color:var(--text-muted)]";
  return n > 0 ? "hib-target-up" : "hib-target-down";
}

function actionTone(row: Record<string, unknown>): string {
  const action = `${text(row.Action)} ${text(row.priceTargetAction)} ${text(row.ToGrade)} ${text(row.FromGrade)}`.toLowerCase();
  if (text(row.Action).toLowerCase() === "up" || action.includes("upgrade") || action.includes("raises")) {
    return "border-[color:var(--success)] text-[color:var(--success)]";
  }
  if (text(row.Action).toLowerCase() === "down" || action.includes("downgrade") || action.includes("lowers")) {
    return "border-[color:var(--danger)] text-[color:var(--danger)]";
  }
  return "border-[color:var(--border-strong)] text-[color:var(--text-muted)]";
}

function clampPct(value: number, low: number, high: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high) || high <= low) return 50;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}

function recommendationCounts(metrics: NonNullable<WallStPayload["metrics"]>["recommendations"]) {
  const latest = metrics?.latest || {};
  const keys = [
    ["strongBuy", "Strong Buy", "bg-[color:var(--signal-strong)]"],
    ["buy", "Buy", "bg-[color:var(--signal-buy)]"],
    ["hold", "Hold", "bg-[color:var(--signal-hold)]"],
    ["sell", "Sell", "bg-[color:var(--signal-sell)]"],
    ["strongSell", "Strong Sell", "bg-[color:var(--danger)]"],
  ] as const;
  return keys.map(([key, label, cls]) => ({ key, label, cls, value: num(latest[key]) || 0 }));
}

function EmptyWallSt({ errors }: { errors: string[] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[color:var(--text-muted)]">
          <LineChart size={16} />
        </div>
        <div>
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">Wall ST unavailable</h2>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            {errors[0] || "Run a fresh analysis to populate analyst expectation data."}
          </p>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">{label}</p>
      <p className={`mt-2 font-display text-2xl leading-none ${tone || "text-[color:var(--text-primary)]"}`}>{value}</p>
      {detail ? <p className="mt-2 text-xs text-[color:var(--text-muted)]">{detail}</p> : null}
    </article>
  );
}

function StreetRange({ targets, currency }: { targets: NonNullable<WallStPayload["metrics"]>["targets"]; currency: string }) {
  const low = num(targets?.low);
  const high = num(targets?.high);
  const current = num(targets?.current);
  const mean = num(targets?.mean);
  const median = num(targets?.median);
  const valid = low !== null && high !== null && high > low;
  const meanPct = valid && mean !== null ? clampPct(mean, low, high) : 50;
  const currentPct = valid && current !== null ? clampPct(current, low, high) : 50;
  const medianPct = valid && median !== null ? clampPct(median, low, high) : 50;
  const positive = mean !== null && current !== null && mean > current;
  const negative = mean !== null && current !== null && mean < current;

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Street Range</p>
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">Where consensus sits against the tape</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
          {currency}
        </span>
      </div>
      {!valid ? (
        <p className="text-sm text-[color:var(--text-secondary)]">No usable low/high analyst target range was returned.</p>
      ) : (
        <div className="px-2 py-5">
          <div className="relative h-3 rounded-full bg-white/5">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${positive ? "bg-[color:var(--success)]" : negative ? "bg-[color:var(--danger)]" : "bg-[color:var(--text-disabled)]"}`}
              style={{ width: `${Math.max(4, meanPct)}%` }}
            />
            <div className="absolute -top-3 h-9 w-px bg-[color:var(--warning)]" style={{ left: `${currentPct}%` }} />
            <div className="absolute -top-2 h-7 w-px bg-[color:var(--text-primary)]" style={{ left: `${medianPct}%` }} />
            <div className="absolute -top-4 h-11 w-1 rounded-full bg-[color:var(--accent)]" style={{ left: `${meanPct}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[color:var(--text-muted)] sm:grid-cols-4">
            <span>Low {fmtNum(low)}</span>
            <span>Current {fmtNum(current)}</span>
            <span>Median {fmtNum(median)}</span>
            <span>High {fmtNum(high)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function RecommendationMix({ metrics }: { metrics: NonNullable<WallStPayload["metrics"]>["recommendations"] }) {
  const counts = recommendationCounts(metrics);
  const total = counts.reduce((sum, item) => sum + item.value, 0);
  const trend = text(metrics?.trend || "unavailable");
  const posture = text(metrics?.posture || "unavailable");

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
          <BarChart3 size={18} />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Recommendation Mix</p>
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">{posture.replace("-", " ")}</h2>
          <p className="text-xs text-[color:var(--text-muted)]">Trend: {trend}</p>
        </div>
      </div>
      {total <= 0 ? (
        <p className="text-sm text-[color:var(--text-secondary)]">No recommendation mix was returned.</p>
      ) : (
        <>
          <div className="flex h-4 overflow-hidden rounded-full bg-white/5">
            {counts.map((item) => (
              <div
                key={item.key}
                className={item.cls}
                title={`${item.label}: ${item.value}`}
                style={{ width: `${(item.value / total) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            {counts.map((item) => (
              <div key={item.key} className="rounded-xl border border-white/10 bg-white/5 p-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">{item.label}</p>
                <p className="mt-1 font-mono text-sm font-semibold text-[color:var(--text-primary)]">{item.value}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function EstimateTable({
  title,
  subtitle,
  rows,
  mode,
}: {
  title: string;
  subtitle: string;
  rows: Array<Record<string, unknown>>;
  mode: "earnings" | "revenue";
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
          <FileText size={18} />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">{subtitle}</p>
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">{title}</h2>
        </div>
      </div>
      {!rows.length ? (
        <p className="text-sm text-[color:var(--text-secondary)]">No {title.toLowerCase()} table was returned.</p>
      ) : (
        <div className="hib-market-table-wrap">
          <table className="hib-market-table min-w-[46rem]">
            <thead>
              <tr>
                <th className="hib-market-table-head">Period</th>
                <th className="hib-market-table-head">Avg</th>
                <th className="hib-market-table-head">Low</th>
                <th className="hib-market-table-head">High</th>
                <th className="hib-market-table-head">Year Ago</th>
                <th className="hib-market-table-head">Growth</th>
                <th className="hib-market-table-head">Analysts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const growth = row.growth;
                const valueFmt = mode === "revenue" ? fmtLarge : fmtNum;
                return (
                  <tr key={`${text(row._index)}-${idx}`}>
                    <td className="hib-market-table-cell font-mono text-xs">{text(row._index) || "-"}</td>
                    <td className="hib-market-table-cell font-mono">{valueFmt(row.avg)}</td>
                    <td className="hib-market-table-cell font-mono">{valueFmt(row.low)}</td>
                    <td className="hib-market-table-cell font-mono">{valueFmt(row.high)}</td>
                    <td className="hib-market-table-cell font-mono">{valueFmt(row.yearAgoEps ?? row.yearAgoRevenue)}</td>
                    <td className={`hib-market-table-cell font-mono font-semibold ${toneClass(growth)}`}>{fmtGrowth(growth)}</td>
                    <td className="hib-market-table-cell font-mono">{fmtNum(row.numberOfAnalysts, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ActionTape({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
          <Activity size={18} />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Recent Actions</p>
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">Upgrade / Downgrade Tape</h2>
        </div>
      </div>
      {!rows.length ? (
        <p className="text-sm text-[color:var(--text-secondary)]">No recent upgrade or downgrade tape was returned.</p>
      ) : (
        <div className="hib-market-table-wrap">
          <table className="hib-market-table min-w-[62rem] table-fixed">
            <colgroup>
              <col className="w-[10rem]" />
              <col className="w-[13rem]" />
              <col className="w-[7rem]" />
              <col className="w-[10rem]" />
              <col className="w-[10rem]" />
              <col className="w-[8rem]" />
              <col className="w-[7rem]" />
              <col className="w-[7rem]" />
            </colgroup>
            <thead>
              <tr>
                <th className="hib-market-table-head">Date</th>
                <th className="hib-market-table-head">Firm</th>
                <th className="hib-market-table-head">Action</th>
                <th className="hib-market-table-head">From</th>
                <th className="hib-market-table-head">To</th>
                <th className="hib-market-table-head">Target</th>
                <th className="hib-market-table-head">Prior</th>
                <th className="hib-market-table-head">Current</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row, idx) => (
                <tr key={`${text(row.Firm)}-${text(row._index)}-${idx}`}>
                  <td className="hib-market-table-cell whitespace-nowrap font-mono text-xs">{text(row._index) || "-"}</td>
                  <td className="hib-market-table-cell break-words font-semibold">{text(row.Firm) || "-"}</td>
                  <td className="hib-market-table-cell">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${actionTone(row)}`}>
                      {text(row.Action) || "main"}
                    </span>
                  </td>
                  <td className="hib-market-table-cell">{text(row.FromGrade) || "-"}</td>
                  <td className="hib-market-table-cell">{text(row.ToGrade) || "-"}</td>
                  <td className="hib-market-table-cell">{text(row.priceTargetAction) || "-"}</td>
                  <td className="hib-market-table-cell font-mono">{fmtNum(row.priorPriceTarget)}</td>
                  <td className="hib-market-table-cell font-mono">{fmtNum(row.currentPriceTarget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function WallStClient({ ticker, data, reportsForTicker, resolvedReportId }: WallStClientProps) {
  const wallSt = data.wall_st || {};
  const metrics = wallSt.metrics || {};
  const targets = metrics.targets || {};
  const recommendations = metrics.recommendations || {};
  const raw = wallSt.raw || {};
  const currency = raw.currency || {};
  const priceCurrency = text(currency.original_price_currency || data.header.display_currency || data.header.currency || "USD");
  const financialCurrency = text(currency.original_financial_currency || priceCurrency);
  const errors = Array.isArray(wallSt.errors) ? wallSt.errors.filter(Boolean) : [];
  const status = text(wallSt.status || "unavailable");
  const synthesisBullets = Array.isArray(wallSt.synthesis?.bullets) ? wallSt.synthesis.bullets.filter(Boolean) : [];
  const actionRows = Array.isArray(metrics.recent_actions) ? metrics.recent_actions : [];
  const earningsRows = Array.isArray(metrics.earnings_rows) ? metrics.earnings_rows : [];
  const revenueRows = Array.isArray(metrics.revenue_rows) ? metrics.revenue_rows : [];
  const analystCount = num(raw.num_of_analysts) ?? num(recommendations.total);
  const stanceScore = num(recommendations.stance_score);

  return (
    <div>
      <ReportChipRow ticker={ticker} reports={reportsForTicker} currentReportId={resolvedReportId} />
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-[color:var(--text-primary)]">Wall ST</h1>
          <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
            {ticker} - analyst expectations in original reported units
          </p>
          <p className="mt-2 text-xs text-[color:var(--text-secondary)]">
            Price targets use {priceCurrency}; revenue and earnings estimates use {financialCurrency}.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--text-muted)]">
          <Gauge size={12} />
          Dashboard-only
        </span>
      </header>

      {status !== "success" ? (
        <EmptyWallSt errors={errors} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard label="Current" value={fmtNum(targets.current)} detail={priceCurrency} tone="text-[color:var(--warning)]" />
            <MetricCard label="Mean Target" value={fmtNum(targets.mean)} detail={fmtPct(targets.upside_pct)} tone={toneClass(targets.upside_pct)} />
            <MetricCard label="Range" value={`${fmtNum(targets.low)} - ${fmtNum(targets.high)}`} detail={priceCurrency} />
            <MetricCard label="Median" value={fmtNum(targets.median)} detail={priceCurrency} />
            <MetricCard label="Analysts" value={fmtNum(analystCount, 0)} detail="latest coverage count" />
            <MetricCard label="Street Score" value={stanceScore === null ? "-" : stanceScore.toFixed(2)} detail={text(recommendations.posture || "recommendations")} tone={toneClass(stanceScore)} />
          </div>

          {synthesisBullets.length ? (
            <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <div className="mb-3 flex items-start gap-3">
                <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
                  <ListChecks size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Street Read</p>
                  <h2 className="font-display text-lg text-[color:var(--text-primary)]">Dashboard-only synthesis</h2>
                </div>
              </div>
              <ul className="space-y-2 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                {synthesisBullets.map((item, idx) => (
                  <li key={`${item}-${idx}`} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <StreetRange targets={targets} currency={priceCurrency} />
            <RecommendationMix metrics={recommendations} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <EstimateTable title="Earnings Estimates" subtitle="EPS expectations" rows={earningsRows} mode="earnings" />
            <EstimateTable title="Revenue Estimates" subtitle={`Revenue expectations - ${financialCurrency}`} rows={revenueRows} mode="revenue" />
          </div>

          <ActionTape rows={actionRows} />

          {num(targets.upside_pct) !== null && num(targets.upside_pct)! < 0 ? (
            <div className="rounded-2xl border border-white/10 bg-red-500/10 p-3 text-sm text-red-100">
              <div className="flex items-center gap-2 font-semibold">
                <TrendingDown size={15} />
                Street target sits below current price.
              </div>
            </div>
          ) : num(targets.upside_pct) !== null && num(targets.upside_pct)! > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              <div className="flex items-center gap-2 font-semibold">
                <TrendingUp size={15} />
                Street target sits above current price.
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
