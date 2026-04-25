"use client";

import Link from "next/link";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useDashboardPayload } from "@/lib/use-dashboard-payload";
import { DashboardError, DashboardSkeleton, ReportChipRow } from "@/components/dashboard-chrome";
import {
  buildCurrencyContext,
  fmtMoney,
  fmtMarketCap,
  fmtMoneyCompact,
} from "@/components/hedge-dashboard";

function fmtPct(v?: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function decisionSignal(pct?: number | null) {
  const v = typeof pct === "number" && Number.isFinite(pct) ? pct : 0;
  if (v <= -10) return { label: "Strong Sell", tone: "negative" as const };
  if (v < -1) return { label: "Sell", tone: "negative" as const };
  if (v < 1) return { label: "Hold", tone: "neutral" as const };
  if (v < 10) return { label: "Buy", tone: "positive" as const };
  return { label: "Strong Buy", tone: "positive" as const };
}

export default function DashboardOverviewPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const upper = decodeURIComponent(ticker).toUpperCase();
  const search = useSearchParams();
  const reportId = search?.get("report") || undefined;
  const { data, loading, error, reportsForTicker, resolvedReportId } = useDashboardPayload(upper, reportId);

  if (loading && !data) return <DashboardSkeleton />;
  if (!data) return <DashboardError error={error || "No data"} ticker={upper} />;

  const ctx = buildCurrencyContext(data);
  const consensus = data.valuation_hub.consensus;
  const current = typeof consensus?.current_price === "number" ? consensus.current_price : null;
  const mean = typeof consensus?.mean_target_price === "number" ? consensus.mean_target_price : null;
  const changePct =
    typeof current === "number" && typeof mean === "number" && Math.abs(current) > 1e-9
      ? ((mean - current) / current) * 100
      : null;
  const signal = decisionSignal(data.decision_card?.position_size_pct_of_notional);
  const toneClass =
    signal.tone === "positive" ? "hib-target-up" : signal.tone === "negative" ? "hib-target-down" : "text-zinc-200";
  const changeClass =
    typeof changePct === "number" && Math.abs(changePct) > 1e-9
      ? changePct > 0
        ? "hib-target-up"
        : "hib-target-down"
      : "text-zinc-200";

  const flags = (data.red_flag_shield || []).filter(Boolean);
  const teaserFlags = flags.slice(0, 3);
  const shift = data.analysis_matrix?.structural_shift;

  const execMarkdown = (data.analysis_matrix?.executive_summary_markdown || "").trim();

  const targetRows = (data.valuation_hub.method_blocks || [])
    .filter((b) => typeof b.target_price === "number" && Number.isFinite(Number(b.target_price)))
    .slice()
    .sort((a, b) => Number(b.target_price) - Number(a.target_price))
    .slice(0, 6);

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{data.ticker}</p>
            <h1 className="font-display text-2xl text-zinc-100">{data.header.company_name || data.ticker}</h1>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Decision</p>
            <p className={`text-3xl font-bold ${toneClass}`}>{signal.label}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Current Price</p>
            <p className="hib-current-price mt-1 text-2xl font-bold">{fmtMoney(current, ctx, "price")}</p>
            <p className="mt-1 text-xs text-zinc-500">Market cap {fmtMarketCap(data.header.market_cap, ctx)}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Mean Target</p>
            <p className={`mt-1 text-2xl font-bold ${typeof mean === "number" && typeof current === "number" ? (mean > current ? "hib-target-up" : "hib-target-down") : "text-zinc-200"}`}>
              {fmtMoney(mean, ctx, "price")}
            </p>
            <p className={`mt-1 text-xs font-semibold ${changeClass}`}>{fmtPct(changePct)}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Investment Sizing</p>
            <p className={`mt-1 text-2xl font-bold ${toneClass}`}>
              {typeof data.decision_card?.position_size_pct_of_notional === "number"
                ? `${data.decision_card.position_size_pct_of_notional.toFixed(2)}%`
                : "N/A"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">of notional</p>
          </div>
        </div>

        {shift?.triggered ? (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
              shift.direction === "up"
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                : "border-red-400/40 bg-red-500/10 text-red-100"
            }`}
          >
            {shift.direction === "up" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            <span className="font-semibold uppercase tracking-[0.14em]">Structural shift ({shift.direction})</span>
            <span className="opacity-85">
              52-week change {typeof shift.change_pct_52w === "number" ? fmtPct(shift.change_pct_52w) : "N/A"}
            </span>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Executive Summary</h2>
          {execMarkdown ? (
            <div className="hib-markdown text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{execMarkdown}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Executive summary not available for this report.</p>
          )}
        </section>

        <div className="space-y-4">
          {flags.length ? (
            <section className="hib-flag-card rounded-2xl border p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle size={14} />
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em]">Red Flags ({flags.length})</h2>
              </div>
              <ul className="space-y-2 text-xs">
                {teaserFlags.map((flag, idx) => (
                  <li key={`flag-${idx}`} className="flex items-start gap-2">
                    <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
              {flags.length > teaserFlags.length ? (
                <Link
                  href={`/dashboard/${encodeURIComponent(upper)}/flags`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] hover:underline"
                >
                  See all {flags.length} flags <ArrowRight size={12} />
                </Link>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Top Targets</h2>
            <ul className="space-y-1 text-xs">
              {targetRows.map((row) => {
                const changePctRow =
                  typeof current === "number" && typeof row.target_price === "number" && Math.abs(current) > 1e-9
                    ? ((Number(row.target_price) - current) / current) * 100
                    : null;
                const tone =
                  typeof changePctRow === "number" && Math.abs(changePctRow) > 1e-9
                    ? changePctRow > 0
                      ? "hib-target-up"
                      : "hib-target-down"
                    : "text-zinc-200";
                return (
                  <li key={row.name} className="flex items-center justify-between gap-3 rounded-md border border-white/5 bg-black/20 px-2 py-1.5">
                    <span className="truncate text-zinc-200">{row.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100">{fmtMoneyCompact(row.target_price, ctx, "price")}</span>
                      <span className={`text-[10px] ${tone}`}>{fmtPct(changePctRow)}</span>
                    </span>
                  </li>
                );
              })}
              {!targetRows.length ? <li className="text-zinc-500">No models yielded a target.</li> : null}
            </ul>
            <Link
              href={`/dashboard/${encodeURIComponent(upper)}/valuation`}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 hover:text-zinc-100"
            >
              Open full valuation <ArrowRight size={12} />
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
