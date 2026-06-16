"use client";

import { Activity, BarChart3, FileText, Gauge, Info, LineChart, ListChecks, TrendingDown, TrendingUp } from "lucide-react";

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

function fmtSignedNum(value: unknown): string {
  const n = num(value);
  if (n === null) return "-";
  return `${n > 0 ? "+" : ""}${fmtNum(n)}`;
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

function pctFromCurrent(value: unknown, current: unknown): number | null {
  const v = num(value);
  const c = num(current);
  if (v === null || c === null || Math.abs(c) <= 1e-9) return null;
  return ((v - c) / c) * 100;
}

function periodLabel(value: unknown): string {
  const raw = text(value);
  const normalized = raw.toLowerCase().replace(/\s+/g, "");
  const match = normalized.match(/^([+-]?\d+)([qym])$/) || normalized.match(/^([qym])(\d+)\+$/);
  if (!match) return raw || "-";
  const unit = Number.isNaN(Number(match[1])) ? match[1] : match[2];
  const offset = Number.isNaN(Number(match[1])) ? Number(match[2]) : Number(match[1]);
  if (unit === "q") {
    if (offset === 0) return "Current Q";
    if (offset === 1) return "Next Q";
    if (offset > 1) return `Q+${offset}`;
    return `Q${offset}`;
  }
  if (unit === "y") {
    if (offset === 0) return "This FY";
    if (offset === 1) return "Next FY";
    if (offset > 1) return `FY+${offset}`;
    return `FY${offset}`;
  }
  if (unit === "m") {
    if (offset === 0) return "Current";
    if (offset === -1) return "1M ago";
    if (offset < 0) return `${Math.abs(offset)}M ago`;
    return `${offset}M ahead`;
  }
  return raw || "-";
}

function dateLabel(value: unknown): string {
  const raw = text(value);
  if (!raw) return "-";
  const dateOnly = raw.split(/[T\s]/)[0];
  return dateOnly || raw;
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

function targetActionTone(row: Record<string, unknown>): string {
  const action = `${text(row.priceTargetAction)} ${text(row.Action)}`.toLowerCase();
  const prior = num(row.priorPriceTarget);
  const current = num(row.currentPriceTarget);
  if (action.includes("raise") || action.includes("increase") || (prior !== null && current !== null && current > prior)) {
    return "hib-target-up";
  }
  if (action.includes("lower") || action.includes("cut") || action.includes("reduce") || (prior !== null && current !== null && current < prior)) {
    return "hib-target-down";
  }
  return "text-[color:var(--text-muted)]";
}

function targetChange(row: Record<string, unknown>): number | null {
  const prior = num(row.priorPriceTarget);
  const current = num(row.currentPriceTarget);
  if (prior === null || current === null || Math.abs(current - prior) <= 1e-9) return null;
  return current - prior;
}

function clampPct(value: number, low: number, high: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high) || high <= low) return 50;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}

type StreetMarker = {
  label: string;
  value: number | null;
  change: number | null | undefined;
  pct: number;
  preferredLane: "top" | "bottom";
  translateClass: string;
  dotClass: string;
  labelClass: string;
};

type PlacedStreetMarker = StreetMarker & {
  lane: "top" | "bottom";
  row: number;
};

function placeStreetMarkers(markers: StreetMarker[]): PlacedStreetMarker[] {
  const sorted = markers.slice().sort((a, b) => a.pct - b.pct || a.label.localeCompare(b.label));
  const lastByLane: Record<"top" | "bottom", number[]> = { top: [], bottom: [] };
  const minGapPct = 13;

  return sorted.map((marker) => {
    const laneOrder: Array<"top" | "bottom"> =
      marker.preferredLane === "top" ? ["top", "bottom"] : ["bottom", "top"];
    for (const lane of laneOrder) {
      for (let row = 0; row < 3; row += 1) {
        const lastPct = lastByLane[lane][row];
        if (lastPct === undefined || Math.abs(marker.pct - lastPct) >= minGapPct) {
          lastByLane[lane][row] = marker.pct;
          return { ...marker, lane, row };
        }
      }
    }

    const fallbackLane = marker.preferredLane;
    const bestRow = lastByLane[fallbackLane]
      .map((lastPct, row) => ({ row, distance: Math.abs(marker.pct - lastPct) }))
      .sort((a, b) => b.distance - a.distance)[0]?.row ?? 0;
    lastByLane[fallbackLane][bestRow] = marker.pct;
    return { ...marker, lane: fallbackLane, row: bestRow };
  });
}

function recommendationCounts(metrics: NonNullable<WallStPayload["metrics"]>["recommendations"]) {
  const latest = metrics?.latest || {};
  const keys = [
    ["strongSell", "Strong Sell", "hib-wallst-strong-sell-bg", "hib-wallst-strong-sell-tone", "hib-wallst-strong-sell-tone"],
    ["sell", "Sell", "hib-wallst-sell-bg", "hib-wallst-sell-tone", "hib-wallst-sell-tone"],
    ["hold", "Hold", "bg-[color:var(--signal-hold)]", "border-[color:var(--signal-hold)]", "hib-signal-hold"],
    ["buy", "Buy", "hib-wallst-buy-bg", "hib-wallst-buy-tone", "hib-wallst-buy-tone"],
    ["strongBuy", "Strong Buy", "hib-wallst-strong-buy-bg", "hib-wallst-strong-buy-tone", "hib-wallst-strong-buy-tone"],
  ] as const;
  return keys.map(([key, label, barClass, borderClass, textClass]) => ({
    key,
    label,
    barClass,
    borderClass,
    textClass,
    value: num(latest[key]) || 0,
  }));
}

function EmptyWallSt({ errors }: { errors: string[] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[color:var(--text-muted)]">
          <LineChart size={16} />
        </div>
        <div>
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">WALL ST. unavailable</h2>
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
  detailTone,
  tone,
  info,
}: {
  label: string;
  value: string;
  detail?: string;
  detailTone?: string;
  tone?: string;
  info?: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">{label}</p>
        {info ? (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/10 text-[color:var(--text-muted)]"
            title={info}
            aria-label={info}
          >
            <Info size={10} />
          </span>
        ) : null}
      </div>
      <p className={`mt-2 font-display text-2xl leading-none ${tone || "text-[color:var(--text-primary)]"}`}>{value}</p>
      {detail ? <p className={`mt-2 text-xs ${detailTone || "text-[color:var(--text-muted)]"}`}>{detail}</p> : null}
    </article>
  );
}

function RangeMetricCard({ low, high, current }: { low: unknown; high: unknown; current: unknown }) {
  const lowPct = pctFromCurrent(low, current);
  const highPct = pctFromCurrent(high, current);
  return (
    <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Range</p>
      <div className="mt-2 space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Low</p>
          <p className={`font-display text-xl leading-none ${toneClass(lowPct)}`}>
            {fmtNum(low)} <span className="text-xs">({fmtPct(lowPct)})</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-muted)]">High</p>
          <p className={`font-display text-xl leading-none ${toneClass(highPct)}`}>
            {fmtNum(high)} <span className="text-xs">({fmtPct(highPct)})</span>
          </p>
        </div>
      </div>
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
  const railLow = valid ? Math.min(low, current ?? low) : null;
  const railHigh = valid ? Math.max(high, current ?? high) : null;
  const lowPct = valid && railLow !== null && railHigh !== null ? clampPct(low, railLow, railHigh) : 0;
  const highPct = valid && railLow !== null && railHigh !== null ? clampPct(high, railLow, railHigh) : 100;
  const meanPct = valid && railLow !== null && railHigh !== null && mean !== null ? clampPct(mean, railLow, railHigh) : 50;
  const currentPct = valid && railLow !== null && railHigh !== null && current !== null ? clampPct(current, railLow, railHigh) : 50;
  const medianPct = valid && railLow !== null && railHigh !== null && median !== null ? clampPct(median, railLow, railHigh) : 50;
  const lowChangePct = pctFromCurrent(low, current);
  const highChangePct = pctFromCurrent(high, current);
  const medianChangePct = pctFromCurrent(median, current);
  const railPct = (pct: number) => 3 + (pct * 94) / 100;
  const analystDotClass = "bg-[color:var(--text-primary)]";
  const analystLabelClass = "text-[color:var(--text-primary)]";
  const markers = placeStreetMarkers([
    { label: "Low", value: low, change: lowChangePct, pct: railPct(lowPct), preferredLane: "top", translateClass: "-translate-x-1/2", dotClass: analystDotClass, labelClass: analystLabelClass },
    { label: "Current", value: current, change: null, pct: railPct(currentPct), preferredLane: "bottom", translateClass: "-translate-x-1/2", dotClass: "bg-[color:var(--warning)]", labelClass: "text-[color:var(--warning)]" },
    { label: "Median", value: median, change: medianChangePct, pct: railPct(medianPct), preferredLane: "top", translateClass: "-translate-x-1/2", dotClass: analystDotClass, labelClass: analystLabelClass },
    { label: "Mean", value: mean, change: targets?.upside_pct, pct: railPct(meanPct), preferredLane: "bottom", translateClass: "-translate-x-1/2", dotClass: analystDotClass, labelClass: analystLabelClass },
    { label: "High", value: high, change: highChangePct, pct: railPct(highPct), preferredLane: "top", translateClass: "-translate-x-full", dotClass: analystDotClass, labelClass: analystLabelClass },
  ]);
  const labelTopClass = (row: number) => ["top-0", "top-10", "top-20"][row] || "top-0";
  const labelBottomClass = (row: number) => ["top-24", "top-32", "top-40"][row] || "top-24";

  return (
    <section className="min-w-0 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
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
          <div className="relative h-56">
            <div className="hib-wallst-range-rail absolute left-[3%] right-[3%] top-16 h-2 rounded-full" aria-label="Current price and analyst target range" />
            {markers.map((marker) => (
              <div
                key={`marker-${marker.label}`}
                className={`absolute inset-y-0 w-max ${marker.translateClass}`}
                style={{ left: `${marker.pct}%` }}
                title={`${marker.label}: ${fmtNum(marker.value)}${marker.change !== null ? ` (${fmtPct(marker.change)})` : ""}`}
              >
                {marker.lane === "top" ? (
                  <div className={`absolute ${labelTopClass(marker.row)} flex flex-col gap-0.5`}>
                    <span className={`whitespace-nowrap text-xs font-semibold ${marker.labelClass}`}>{marker.label}</span>
                    <span className="whitespace-nowrap font-mono text-[11px] text-[color:var(--text-secondary)]">{fmtNum(marker.value)}</span>
                    {marker.change !== null ? (
                      <span className={`whitespace-nowrap font-mono text-[11px] ${toneClass(marker.change)}`}>{fmtPct(marker.change)}</span>
                    ) : null}
                  </div>
                ) : null}
                <span className={`absolute left-1/2 h-7 w-px -translate-x-1/2 ${marker.lane === "top" ? "top-9" : "top-16"} ${marker.dotClass}`} />
                <span className={`absolute left-1/2 top-[3.625rem] h-3 w-3 -translate-x-1/2 rounded-full ring-2 ring-[color:var(--surface)] ${marker.dotClass}`} />
                {marker.lane === "bottom" ? (
                  <div className={`absolute ${labelBottomClass(marker.row)} flex flex-col gap-0.5`}>
                    <span className={`whitespace-nowrap text-xs font-semibold ${marker.labelClass}`}>{marker.label}</span>
                    <span className="whitespace-nowrap font-mono text-[11px] text-[color:var(--text-secondary)]">{fmtNum(marker.value)}</span>
                    {marker.change !== null ? (
                      <span className={`whitespace-nowrap font-mono text-[11px] ${toneClass(marker.change)}`}>{fmtPct(marker.change)}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
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
    <section className="min-w-0 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="shrink-0 rounded-xl border border-white/10 bg-black/25 p-2 text-[color:var(--accent)]">
          <BarChart3 size={18} />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Recommendation Mix</p>
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">{posture.replace("-", " ")}</h2>
          <p className="text-xs text-[color:var(--text-muted)]">
            {total} analysts in the latest mix. Trend: {trend}.
          </p>
        </div>
      </div>
      {total <= 0 ? (
        <p className="text-sm text-[color:var(--text-secondary)]">No recommendation mix was returned.</p>
      ) : (
        <>
          <div className="flex h-5 overflow-hidden rounded-full bg-white/5" aria-label="Recommendation mix by analyst count">
            {counts.map((item) => (
              <div
                key={item.key}
                className={item.barClass}
                title={`${item.label}: ${item.value} (${((item.value / total) * 100).toFixed(0)}%)`}
                style={{ width: `${(item.value / total) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            {counts.map((item) => (
              <div key={item.key} className={`flex min-h-28 flex-col rounded-xl border bg-white/5 p-2 ${item.borderClass}`}>
                <p className="min-h-8 text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-muted)]">{item.label}</p>
                <p className={`mt-auto font-mono text-lg font-semibold ${item.textClass}`}>{item.value}</p>
                <p className="text-[10px] text-[color:var(--text-muted)]">{((item.value / total) * 100).toFixed(0)}%</p>
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
    <section className="min-w-0 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
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
        <div className="hib-market-table-wrap w-full">
          <table className="hib-market-table min-w-[42rem]">
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
                    <td className="hib-market-table-cell font-semibold">{periodLabel(row._index)}</td>
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
    <section className="min-w-0 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
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
          <table className="hib-market-table min-w-[54rem] table-fixed">
            <colgroup>
              <col className="w-[7rem]" />
              <col className="w-[10rem]" />
              <col className="w-[6.5rem]" />
              <col className="w-[10rem]" />
              <col className="w-[10rem]" />
              <col className="w-[7.5rem]" />
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
                  <td className="hib-market-table-cell whitespace-nowrap font-mono text-xs">{dateLabel(row._index)}</td>
                  <td className="hib-market-table-cell break-words font-semibold">{text(row.Firm) || "-"}</td>
                  <td className="hib-market-table-cell">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${actionTone(row)}`}>
                      {text(row.Action) || "main"}
                    </span>
                  </td>
                  <td className="hib-market-table-cell">{text(row.FromGrade) || "-"}</td>
                  <td className="hib-market-table-cell">{text(row.ToGrade) || "-"}</td>
                  <td className={`hib-market-table-cell font-semibold ${targetActionTone(row)}`}>
                    {text(row.priceTargetAction) || "-"}
                    {targetChange(row) !== null ? <span className="ml-1 text-[10px]">({fmtSignedNum(targetChange(row))})</span> : null}
                  </td>
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
          <h1 className="font-display text-2xl text-[color:var(--text-primary)]">WALL ST.</h1>
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
            <MetricCard
              label="Mean Target"
              value={fmtNum(targets.mean)}
              detail={fmtPct(targets.upside_pct)}
              detailTone={toneClass(targets.upside_pct)}
              tone={toneClass(targets.upside_pct)}
            />
            <RangeMetricCard low={targets.low} high={targets.high} current={targets.current} />
            <MetricCard
              label="Median"
              value={fmtNum(targets.median)}
              detail={fmtPct(pctFromCurrent(targets.median, targets.current))}
              detailTone={toneClass(pctFromCurrent(targets.median, targets.current))}
              tone={toneClass(pctFromCurrent(targets.median, targets.current))}
            />
            <MetricCard label="Analysts" value={fmtNum(analystCount, 0)} detail="latest coverage count" />
            <MetricCard
              label="Street Score"
              value={stanceScore === null ? "-" : stanceScore.toFixed(2)}
              detail={text(recommendations.posture || "recommendations")}
              tone={toneClass(stanceScore)}
              info="A -2 to +2 rating mix score: Strong Buy is +2, Buy +1, Hold 0, Sell -1, and Strong Sell -2."
            />
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
