"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { ReportChipRow } from "@/components/dashboard-chrome";
import {
  buildCurrencyContext,
  fmtMoney,
  fmtMoneyCompact,
} from "@/components/hedge-dashboard";
import { INVESTORS_ORDERED, OVERVIEW_FEATURED_PERSONAS } from "@/components/dream-team/persona-themes";
import { disagreementScoreForReport } from "@/lib/ticker-summary-aggregate";

function fmtPct(v?: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function combinedScore(investmentPct?: number | null, targetReturnPct?: number | null): number | null {
  const hasInvestment = typeof investmentPct === "number" && Number.isFinite(investmentPct);
  const hasTarget = typeof targetReturnPct === "number" && Number.isFinite(targetReturnPct);
  if (!hasInvestment && !hasTarget) return null;
  if (hasInvestment && hasTarget) return (0.4 * Number(investmentPct)) + (0.6 * Number(targetReturnPct));
  return hasInvestment ? Number(investmentPct) : Number(targetReturnPct);
}

function confidenceAdjustedScore(baseScore?: number | null, overallCv?: number | null): number | null {
  if (typeof baseScore !== "number" || !Number.isFinite(baseScore)) return null;
  const cv = typeof overallCv === "number" && Number.isFinite(overallCv) ? Math.max(0, overallCv) : 0;
  const confidenceFactor = 1 / (1 + Math.pow(cv, 1.3));
  return baseScore * confidenceFactor;
}

export type OverviewClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
  liveCurrentPrice: number | null;
};

export function OverviewClient({
  ticker,
  data,
  reportsForTicker,
  resolvedReportId,
  liveCurrentPrice,
}: OverviewClientProps) {
  const upper = ticker;
  const ctx = buildCurrencyContext(data);
  const consensus = data.valuation_hub.consensus;
  const scoreCard = data.score_card || data.decision_card || {};
  const current = typeof consensus?.current_price === "number" ? consensus.current_price : null;
  const mean = typeof consensus?.mean_target_price === "number" ? consensus.mean_target_price : null;
  const changePct =
    typeof current === "number" && typeof mean === "number" && Math.abs(current) > 1e-9
      ? ((mean - current) / current) * 100
      : null;
  const positionPct =
    typeof scoreCard?.position_size_pct_of_notional === "number" && Number.isFinite(scoreCard.position_size_pct_of_notional)
      ? Number(scoreCard.position_size_pct_of_notional)
      : null;
  const changeClass =
    typeof changePct === "number" && Math.abs(changePct) > 1e-9
      ? changePct > 0
        ? "hib-target-up"
        : "hib-target-down"
      : "text-zinc-200";
  const liveDeltaPct =
    typeof liveCurrentPrice === "number" && typeof current === "number" && Math.abs(current) > 1e-9
      ? ((liveCurrentPrice - current) / current) * 100
      : null;
  const liveToneClass =
    typeof liveDeltaPct === "number" && Math.abs(liveDeltaPct) > 1e-9
      ? liveDeltaPct > 0
        ? "hib-target-up"
        : "hib-target-down"
      : "text-zinc-200";
  const generatedDateRaw = data.generated_at || data.report_mtime || "";
  const generatedDate = new Date(String(generatedDateRaw || ""));
  const generatedDateLabel =
    Number.isFinite(generatedDate.getTime())
      ? `${generatedDate.getFullYear()}-${String(generatedDate.getMonth() + 1).padStart(2, "0")}-${String(generatedDate.getDate()).padStart(2, "0")}`
      : "N/A";
  const disagreementScore = disagreementScoreForReport(data);
  const finalCombinedScore =
    typeof scoreCard?.combined_score === "number" && Number.isFinite(scoreCard.combined_score)
      ? Number(scoreCard.combined_score)
      : combinedScore(positionPct, changePct);
  const finalAdjustedScore =
    typeof scoreCard?.adjusted_score === "number" && Number.isFinite(scoreCard.adjusted_score)
      ? Number(scoreCard.adjusted_score)
      : confidenceAdjustedScore(finalCombinedScore, disagreementScore);
  const toneClass =
    typeof finalAdjustedScore === "number" && Math.abs(finalAdjustedScore) > 1e-9
      ? finalAdjustedScore > 0
        ? "hib-target-up"
        : "hib-target-down"
      : "text-zinc-200";
  const positionToneClass =
    typeof positionPct === "number" && Math.abs(positionPct) > 1e-9
      ? positionPct > 0
        ? "hib-target-up"
        : "hib-target-down"
      : "text-zinc-200";

  const execMarkdown = (data.analysis_matrix?.executive_summary_markdown || "").trim();

  const targetRows = (data.valuation_hub.method_blocks || [])
    .filter((b) => typeof b.target_price === "number" && Number.isFinite(Number(b.target_price)))
    .slice()
    .sort((a, b) => Number(b.target_price) - Number(a.target_price))
    .slice(0, 6);

  const sortedDreamTeam = (data.dream_team || [])
    .slice()
    .sort((a, b) => {
      const order = INVESTORS_ORDERED as readonly string[];
      const ai = order.indexOf(String(a.persona || "").trim());
      const bi = order.indexOf(String(b.persona || "").trim());
      const aRank = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const bRank = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      return aRank - bRank;
    });
  const featuredMap = new Map(
    sortedDreamTeam.map((entry) => [String(entry.persona || "").trim(), entry]),
  );
  const featured = OVERVIEW_FEATURED_PERSONAS.map((name) => featuredMap.get(name)).filter(
    (entry): entry is NonNullable<typeof entry> => Boolean(entry),
  );
  const featuredOrder = OVERVIEW_FEATURED_PERSONAS as readonly string[];
  const fallback = sortedDreamTeam.filter((entry) => !featuredOrder.includes(String(entry.persona || "").trim()));
  const dreamTeam = [...featured, ...fallback].slice(0, 3);
  const sliceWords = (text: string | undefined, n: number): string => {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    return words.slice(0, n).join(" ") + (words.length > n ? "…" : "");
  };

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />
      {reportsForTicker.length > 1 ? (
        <div className="mb-4">
          <Link
            href={`/dashboard/${encodeURIComponent(upper)}/summary`}
            className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 transition hover:border-white/30 hover:text-zinc-100"
          >
            Open Overall Summary <ArrowRight size={12} />
          </Link>
        </div>
      ) : null}

      <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{data.ticker}</p>
            <h1 className="font-display text-2xl text-zinc-100">{data.header.company_name || data.ticker}</h1>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Score</p>
            <p className={`text-3xl font-bold ${toneClass}`}>
              {typeof finalAdjustedScore === "number" && Number.isFinite(finalAdjustedScore) ? finalAdjustedScore.toFixed(2) : "N/A"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Price ({generatedDateLabel})</p>
            <p className="hib-current-price mt-1 text-2xl font-bold">{fmtMoney(current, ctx, "price")}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Current (Live)</p>
            <p className={`mt-0.5 text-sm font-semibold ${liveToneClass}`}>
              {typeof liveCurrentPrice === "number" && Number.isFinite(liveCurrentPrice)
                ? `${fmtMoney(liveCurrentPrice, ctx, "price")} (${fmtPct(liveDeltaPct)})`
                : "N/A"}
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              Mean Target
            </p>
            <p className={`mt-1 text-2xl font-bold ${typeof mean === "number" && typeof current === "number" ? (mean > current ? "hib-target-up" : "hib-target-down") : "text-zinc-200"}`}>
              {fmtMoney(mean, ctx, "price")}
            </p>
            <p className={`mt-1 text-xs font-semibold ${changeClass}`}>{fmtPct(changePct)}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              Investment Sizing
            </p>
            <p className={`mt-1 text-2xl font-bold ${positionToneClass}`}>
              {typeof scoreCard?.position_size_pct_of_notional === "number"
                ? `${scoreCard.position_size_pct_of_notional.toFixed(2)}%`
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
      </section>

      <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Executive Summary</h2>
        {execMarkdown ? (
          <div className="hib-markdown text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{execMarkdown}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Executive summary not available for this report.</p>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Top Targets</h2>
          <Link
            href={`/dashboard/${encodeURIComponent(upper)}/valuation`}
            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 hover:text-zinc-100"
          >
            Open full valuation <ArrowRight size={12} />
          </Link>
        </div>
        <div className="space-y-2 sm:hidden">
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
              <article key={`${row.name}-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{row.name}</p>
                <p className="mt-1 text-xl font-bold text-zinc-100">{fmtMoneyCompact(row.target_price, ctx, "price")}</p>
                <p className={`mt-1 text-sm font-semibold ${tone}`}>{fmtPct(changePctRow)}</p>
              </article>
            );
          })}
          {!targetRows.length ? <p className="text-sm text-zinc-500">No models yielded a target.</p> : null}
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <table className="hidden w-full min-w-[560px] text-xs sm:table">
            <thead className="border-b border-white/10 text-zinc-400">
              <tr>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.14em]">Method</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.14em]">Target Price</th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.14em]">Upside</th>
              </tr>
            </thead>
            <tbody>
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
                  <tr key={row.name} className="border-b border-white/5 last:border-b-0">
                    <td className="px-3 py-2 text-zinc-200">{row.name}</td>
                    <td className="px-3 py-2 text-right font-semibold text-zinc-100">
                      {fmtMoneyCompact(row.target_price, ctx, "price")}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${tone}`}>{fmtPct(changePctRow)}</td>
                  </tr>
                );
              })}
              {!targetRows.length ? (
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-zinc-500">
                    No models yielded a target.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {dreamTeam.length ? (
        <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Dream Team</h2>
            <Link
              href={`/dashboard/${encodeURIComponent(upper)}/dream-team`}
              className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300 hover:text-zinc-100"
            >
              View full analysis <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {dreamTeam.map((m, idx) => {
              const delta =
                typeof current === "number" && typeof m.target_price === "number" && Math.abs(current) > 1e-9
                  ? ((Number(m.target_price) - current) / current) * 100
                  : null;
              const tone =
                typeof delta === "number" && Math.abs(delta) > 1e-9
                  ? delta > 0
                    ? "hib-target-up"
                    : "hib-target-down"
                  : "text-zinc-200";
              const thesis = sliceWords(m.step_by_step_analysis || m.investment_rationale, 14);
              return (
                <article key={`${m.persona}-${idx}`} className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">AI Persona</p>
                  <p className="text-sm font-semibold text-zinc-100">{m.persona || `Persona ${idx + 1}`}</p>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className={`text-base font-semibold ${tone}`}>{fmtMoney(m.target_price, ctx, "price")}</span>
                    <span className={`text-[10px] ${tone}`}>{fmtPct(delta)}</span>
                  </div>
                  {thesis ? <p className="mt-2 text-xs text-zinc-400">{thesis}</p> : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

    </div>
  );
}
