"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useDashboardPayload } from "@/lib/use-dashboard-payload";
import type { DashboardPayload } from "@/lib/dashboard-types";
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

function combinedDecisionScore(investmentPct?: number | null, targetReturnPct?: number | null): number | null {
  const hasInvestment = typeof investmentPct === "number" && Number.isFinite(investmentPct);
  const hasTarget = typeof targetReturnPct === "number" && Number.isFinite(targetReturnPct);
  if (!hasInvestment && !hasTarget) return null;
  if (hasInvestment && hasTarget) return (0.5 * Number(investmentPct)) + (0.5 * Number(targetReturnPct));
  return hasInvestment ? Number(investmentPct) : Number(targetReturnPct);
}

function confidenceAdjustedScore(baseScore?: number | null, overallCv?: number | null): number | null {
  if (typeof baseScore !== "number" || !Number.isFinite(baseScore)) return null;
  const cv = typeof overallCv === "number" && Number.isFinite(overallCv) ? Math.max(0, overallCv) : 0;
  const confidenceFactor = 1 / (1 + Math.pow(cv, 1.3));
  return baseScore * confidenceFactor;
}

function decisionSignal(adjustedScore?: number | null) {
  const v = typeof adjustedScore === "number" && Number.isFinite(adjustedScore) ? adjustedScore : 0;
  if (v <= -15) return { label: "Strong Sell", tone: "negative" as const };
  if (v < -7) return { label: "Sell", tone: "negative" as const };
  if (v < 7) return { label: "Hold", tone: "neutral" as const };
  if (v < 15) return { label: "Buy", tone: "positive" as const };
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
  const [livePerformance, setLivePerformance] = useState<DashboardPayload["header"]["price_performance_pct"] | null>(null);
  const [livePerformanceKey, setLivePerformanceKey] = useState("");

  useEffect(() => {
    if (!upper) return;
    let cancelled = false;
    const perfKey = `${upper}::${resolvedReportId || "latest"}`;
    fetch(`/api/performance/${encodeURIComponent(upper)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        const returns = json?.returns_pct;
        if (returns && typeof returns === "object") {
          setLivePerformance(returns);
        } else {
          setLivePerformance(null);
        }
        setLivePerformanceKey(perfKey);
      })
      .catch(() => {
        if (!cancelled) {
          setLivePerformance(null);
          setLivePerformanceKey(perfKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [upper, resolvedReportId]);

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
  const positionPct =
    typeof data.decision_card?.position_size_pct_of_notional === "number" && Number.isFinite(data.decision_card.position_size_pct_of_notional)
      ? Number(data.decision_card.position_size_pct_of_notional)
      : null;
  const changeClass =
    typeof changePct === "number" && Math.abs(changePct) > 1e-9
      ? changePct > 0
        ? "hib-target-up"
        : "hib-target-down"
      : "text-zinc-200";
  const generatedDateRaw = data.generated_at || data.report_mtime || "";
  const generatedDate = new Date(String(generatedDateRaw || ""));
  const generatedDateLabel =
    Number.isFinite(generatedDate.getTime())
      ? `${generatedDate.getFullYear()}-${String(generatedDate.getMonth() + 1).padStart(2, "0")}-${String(generatedDate.getDate()).padStart(2, "0")}`
      : "N/A";
  const targetDisagreement =
    typeof consensus?.cv === "number" && Number.isFinite(consensus.cv) ? Math.abs(Number(consensus.cv)) : null;
  const investmentDisagreement =
    Array.isArray(consensus?.lmil) && typeof consensus?.lmil?.[1] === "number" && Number.isFinite(consensus.lmil[1])
      ? Math.abs(Number(consensus.lmil[1]))
      : null;
  const disagreementParts = [targetDisagreement, investmentDisagreement].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const disagreementScore =
    typeof data.decision_card?.overall_cv === "number" && Number.isFinite(data.decision_card.overall_cv)
      ? Math.abs(Number(data.decision_card.overall_cv))
      : disagreementParts.length > 0
        ? disagreementParts.reduce((sum, v) => sum + v, 0) / disagreementParts.length
        : null;
  const finalCombinedScore =
    typeof data.decision_card?.combined_score === "number" && Number.isFinite(data.decision_card.combined_score)
      ? Number(data.decision_card.combined_score)
      : combinedDecisionScore(positionPct, changePct);
  const finalAdjustedScore =
    typeof data.decision_card?.adjusted_score === "number" && Number.isFinite(data.decision_card.adjusted_score)
      ? Number(data.decision_card.adjusted_score)
      : confidenceAdjustedScore(finalCombinedScore, disagreementScore);
  const signal = decisionSignal(finalAdjustedScore);
  const toneClass =
    signal.tone === "positive" ? "hib-target-up" : signal.tone === "negative" ? "hib-target-down" : "text-zinc-200";
  const performanceKey = `${upper}::${resolvedReportId || "latest"}`;
  const performanceLoading = livePerformanceKey !== performanceKey;
  const performanceRows = livePerformance || data?.header?.price_performance_pct || {};

  const flags = (data.red_flag_shield || []).filter(Boolean);
  const teaserFlags = flags.slice(0, 3);

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

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Price ({generatedDateLabel})</p>
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
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Disagreement Score</p>
            <p className="hib-neutral-metric mt-1 text-2xl font-bold">
              {typeof disagreementScore === "number" && Number.isFinite(disagreementScore)
                ? disagreementScore.toFixed(3)
                : "N/A"}
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <p className="text-zinc-500">Price Performance</p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4 xl:grid-cols-8">
            {(["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const).map((key) => {
              const value = performanceRows?.[key];
              return (
                <div key={key} className="hib-perf-cell rounded-md px-2 py-1.5">
                  <span className="block text-[10px] uppercase tracking-[0.12em] text-zinc-500">{key}</span>
                  {performanceLoading ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400">
                      <span className="h-2.5 w-2.5 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
                      Loading
                    </span>
                  ) : (
                    <span className={`mt-1 block text-sm font-semibold ${typeof value === "number" && Number.isFinite(value) && Math.abs(value) > 1e-9 ? (value > 0 ? "hib-target-up" : "hib-target-down") : "text-zinc-200"}`}>
                      {typeof value === "number" && Number.isFinite(value) ? fmtPct(value) : "N/A"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

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
