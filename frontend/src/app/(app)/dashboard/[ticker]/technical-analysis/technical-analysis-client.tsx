"use client";

import { AlertTriangle, CandlestickChart, Shield } from "lucide-react";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { ReportChipRow } from "@/components/dashboard-chrome";
import { buildCurrencyContext, fmtMoneyCompact } from "@/components/hedge-dashboard";

const POET_DEMO_TECHNICAL_ANALYSIS = {
  ticker: "POET",
  analysis_date: "2026-04-25",
  step_by_step_analysis: [
    {
      step: 1,
      title: "Long-term weekly context",
      bullets: [
        "Price is near a major historical resistance zone around the all-time high.",
        "Weekly momentum remains strongly positive, with stretched RSI conditions.",
        "OBV trend confirms strong participation from buyers in recent weeks.",
      ],
    },
    {
      step: 2,
      title: "Medium-term daily context",
      bullets: [
        "Daily structure shows a breakout above prior multi-month resistance.",
        "RSI is in overbought territory, so pullback risk is elevated.",
        "MACD remains bullish, confirming the ongoing trend impulse.",
      ],
    },
    {
      step: 3,
      title: "Short-term setup",
      bullets: [
        "Recent move is parabolic with limited consolidation.",
        "Immediate support is likely around breakout-retest zones.",
        "A close below breakout support would weaken near-term momentum.",
      ],
    },
    {
      step: 4,
      title: "Cross-timeframe conclusion",
      bullets: [
        "Timeframes align on bullish momentum, but overextension is visible.",
        "Continuation is possible, yet mean-reversion risk is materially higher.",
        "Risk management matters more than signal direction at current stretch.",
      ],
    },
  ],
  key_points: [
    "Strong trend confirmation across weekly and daily frames.",
    "Momentum and volume support the move, but conditions are extended.",
    "Technical risk/reward is less attractive after a near-vertical rally.",
  ],
  bullish_points: [
    "Breakout above prior resistance remains intact.",
    "Positive MACD structure across key timeframes.",
    "OBV trend supports accumulation thesis.",
  ],
  bearish_points: [
    "Overbought RSI on multiple timeframes.",
    "Parabolic slope increases sharp pullback probability.",
    "Distance from moving averages suggests stretched conditions.",
  ],
  contradictions_or_divergences: [
    "No clear bearish divergence yet, but volume extremes can be late-cycle signals.",
  ],
  volume_insights: [
    "Recent sessions show unusually high participation relative to baseline.",
    "Sustained high volume after breakout supports trend quality but may also mark climax behavior.",
  ],
  momentum_insights: [
    "Momentum is strong and still constructive.",
    "Failure to hold momentum highs would be an early warning.",
  ],
  risk_signals: [
    "Overbought conditions.",
    "Parabolic price action.",
    "Potential volatility expansion after sharp upside impulse.",
  ],
  target_price_levels: {
    support_levels: [
      { price: 8.59, reason: "Breakout-retest zone", confidence: "low" },
      { price: 7.67, reason: "Dynamic SMA support area", confidence: "low" },
    ],
    resistance_levels: [
      { price: 22.9, reason: "Major historical overhead level", confidence: "low" },
    ],
    bullish_targets: [
      { price: 22.9, reason: "Continuation toward major resistance", timeframe: "short", confidence: "low" },
    ],
    bearish_targets: [
      { price: 8.59, reason: "Pullback to breakout base", timeframe: "short", confidence: "low" },
    ],
  },
  scenario_analysis: {
    bullish_case: {
      summary: "Momentum extends and price challenges historical highs.",
      conditions: ["RSI holds strong", "Volume remains constructive", "Breakout level remains defended"],
      target_zone: { low: 15.1, high: 22.9 },
    },
    base_case: {
      summary: "Price consolidates after the surge and forms a new base.",
      conditions: ["RSI cools", "Volume normalizes", "No decisive breakdown below support"],
      target_zone: { low: 7.67, high: 15.1 },
    },
    bearish_case: {
      summary: "Trend fails and moves into a deeper mean-reversion leg.",
      conditions: ["Support breaks", "RSI rolls over hard", "Down-volume expands"],
      target_zone: { low: 5.08, high: 8.59 },
    },
  },
  what_to_watch_next: [
    "Hold/fail at breakout support.",
    "RSI rollover vs continuation.",
    "Down-day volume behavior.",
  ],
  confidence_score: 0.2,
  bullish_probability: 0.64,
  bearish_probability: 0.36,
  final_decision: "bullish",
  confidence_explanation:
    "Trend and momentum are still aligned bullish across weekly and daily frames, while volume confirms participation. Overbought conditions and parabolic slope raise reversal risk, so bearish probability remains meaningful but lower.",
};

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function asProbability(value: unknown): number | null {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const normalized = raw > 1 ? raw / 100 : raw;
  if (!Number.isFinite(normalized)) return null;
  return Math.max(0, Math.min(1, normalized));
}

function ListPanel({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-zinc-200">
        {items.map((item, idx) => (
          <li key={`${title}-${idx}`} className="flex items-start gap-2">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LevelPanel({
  title,
  levels,
  tone,
  money,
}: {
  title: string;
  levels: Array<{ price?: number; reason?: string; confidence?: string; timeframe?: string }>;
  tone: "up" | "down" | "neutral";
  money: (v?: number | null) => string;
}) {
  if (!levels.length) return null;
  const toneClass = tone === "up" ? "hib-target-up" : tone === "down" ? "hib-target-down" : "text-zinc-200";
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">{title}</h3>
      <div className="mt-3 space-y-2">
        {levels.map((row, idx) => (
          <article key={`${title}-${idx}`} className="rounded-lg border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-base font-semibold ${toneClass}`}>{money(row.price)}</span>
              {row.timeframe ? (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-300">
                  {`${row.timeframe}-term`}
                </span>
              ) : null}
              {row.confidence ? (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                  {`${row.confidence} confidence`}
                </span>
              ) : null}
            </div>
            {row.reason ? <p className="mt-2 text-xs text-zinc-300">{row.reason}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export type TechnicalAnalysisClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

export function TechnicalAnalysisClient({
  ticker,
  data,
  reportsForTicker,
  resolvedReportId,
}: TechnicalAnalysisClientProps) {
  const upper = ticker;
  const ctx = buildCurrencyContext(data);
  const money = (v?: number | null) => fmtMoneyCompact(typeof v === "number" ? v : null, ctx, "price");
  const technicalRaw = data.technical_analysis || {};
  const technical =
    String(technicalRaw.status || "").toLowerCase() === "success"
      ? technicalRaw
      : upper === "POET"
        ? {
            status: "success",
            model: "demo",
            generated_at: new Date().toISOString(),
            analysis: POET_DEMO_TECHNICAL_ANALYSIS,
          }
        : technicalRaw;
  const analysis = technical.analysis || {};
  const status = String(technical.status || "").toLowerCase();

  const steps = Array.isArray(analysis.step_by_step_analysis) ? analysis.step_by_step_analysis : [];
  const keyPoints = asList(analysis.key_points);
  const bullishPoints = asList(analysis.bullish_points);
  const bearishPoints = asList(analysis.bearish_points);
  const volumeInsights = asList(analysis.volume_insights);
  const momentumInsights = asList(analysis.momentum_insights);
  const contradictions = asList(analysis.contradictions_or_divergences);
  const riskSignals = asList(analysis.risk_signals);
  const watchNext = asList(analysis.what_to_watch_next);

  const targetLevels = analysis.target_price_levels || {};
  const supportLevels = Array.isArray(targetLevels.support_levels) ? targetLevels.support_levels : [];
  const resistanceLevels = Array.isArray(targetLevels.resistance_levels) ? targetLevels.resistance_levels : [];
  const bullishTargets = Array.isArray(targetLevels.bullish_targets) ? targetLevels.bullish_targets : [];
  const bearishTargets = Array.isArray(targetLevels.bearish_targets) ? targetLevels.bearish_targets : [];

  const scenarios = analysis.scenario_analysis || {};
  const bullishProbability = asProbability(analysis.bullish_probability);
  const bearishProbability = asProbability(analysis.bearish_probability);
  const probabilityTotal =
    bullishProbability !== null || bearishProbability !== null
      ? (bullishProbability || 0) + (bearishProbability || 0)
      : null;
  const bullishPct =
    bullishProbability !== null
      ? Math.round(((probabilityTotal || 1) > 0 ? (bullishProbability / (probabilityTotal || 1)) : bullishProbability) * 100)
      : null;
  const bearishPct =
    bearishProbability !== null
      ? Math.round(((probabilityTotal || 1) > 0 ? (bearishProbability / (probabilityTotal || 1)) : bearishProbability) * 100)
      : null;
  const finalDecision = String(analysis.final_decision || "").trim().toLowerCase();
  const confidenceExplanation = String(analysis.confidence_explanation || "").trim();
  const decisionTone =
    finalDecision === "bullish" ? "hib-target-up" : finalDecision === "bearish" ? "hib-target-down" : "text-zinc-200";
  const decisionLabel =
    finalDecision === "bullish" ? "Bullish" : finalDecision === "bearish" ? "Bearish" : finalDecision === "neutral" ? "Neutral" : "N/A";

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="inline-flex items-center gap-2 font-display text-2xl text-zinc-100">
              <CandlestickChart size={18} className="text-emerald-300" />
              Technical Analysis
            </h1>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              {upper} · multi-timeframe technical read
            </p>
          </div>
        </div>

      </header>

      {status !== "success" ? (
        <section className="rounded-2xl border border-red-500/35 bg-red-500/10 p-4">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-red-100">
            <AlertTriangle size={14} />
            Technical analysis is not available for this report.
          </p>
          {technical.error ? <p className="mt-2 text-xs text-red-200/90">{technical.error}</p> : null}
        </section>
      ) : (
        <div className="space-y-5">
          {(bullishPct !== null || bearishPct !== null || decisionLabel !== "N/A" || confidenceExplanation) ? (
            <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Probability Decision</h2>
              <div className="mt-3 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <div className="flex items-center justify-end gap-2">
                    <p className={`text-sm font-semibold ${decisionTone}`}>{decisionLabel}</p>
                  </div>
                  {bullishPct !== null ? (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-zinc-300">Bullish Probability</span>
                        <span className="font-semibold hib-target-up">{bullishPct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-800">
                        <div className="h-2 rounded-full bg-emerald-400 transition-all" style={{ width: `${bullishPct}%` }} />
                      </div>
                    </div>
                  ) : null}
                  {bearishPct !== null ? (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-zinc-300">Bearish Probability</span>
                        <span className="font-semibold hib-target-down">{bearishPct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-800">
                        <div className="h-2 rounded-full bg-rose-400 transition-all" style={{ width: `${bearishPct}%` }} />
                      </div>
                    </div>
                  ) : null}
                </div>

                {confidenceExplanation ? (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Explanation</p>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-200">{confidenceExplanation}</p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <h2 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
              <Shield size={13} />
              Scenario Analysis
            </h2>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              {[
                { key: "bullish_case", title: "Bullish Case", tone: "hib-target-up" },
                { key: "base_case", title: "Base Case", tone: "text-zinc-200" },
                { key: "bearish_case", title: "Bearish Case", tone: "hib-target-down" },
              ].map((entry) => {
                const payload = (scenarios as Record<string, { summary?: string; conditions?: string[]; target_zone?: { low?: number; high?: number } }>)[entry.key] || {};
                const conditions = asList(payload.conditions);
                const low = payload.target_zone?.low;
                const high = payload.target_zone?.high;
                return (
                  <article key={entry.key} className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <p className={`text-sm font-semibold ${entry.tone}`}>{entry.title}</p>
                    {payload.summary ? <p className="mt-2 text-xs text-zinc-200">{payload.summary}</p> : null}
                    {typeof low === "number" && typeof high === "number" ? (
                      <p className="mt-2 text-xs text-zinc-300">
                        Target Zone: <span className="font-semibold text-zinc-100">{money(low)} - {money(high)}</span>
                      </p>
                    ) : null}
                    {conditions.length ? (
                      <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                        {conditions.map((cond, idx) => (
                          <li key={`${entry.key}-cond-${idx}`} className="flex gap-2">
                            <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                            <span>{cond}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Target Levels</h2>
            <div className="mt-3 grid gap-4 xl:grid-cols-2">
              <LevelPanel title="Support Levels" levels={supportLevels} tone="neutral" money={money} />
              <LevelPanel title="Resistance Levels" levels={resistanceLevels} tone="neutral" money={money} />
              <LevelPanel title="Bullish Targets" levels={bullishTargets} tone="up" money={money} />
              <LevelPanel title="Bearish Targets" levels={bearishTargets} tone="down" money={money} />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Explanations</h2>
            {steps.length ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {steps.map((step, idx) => {
                  const title = String(step?.title || "").trim() || `Step ${idx + 1}`;
                  const bullets = asList(step?.bullets);
                  return (
                    <article key={`step-${idx}`} className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <p className="text-sm font-semibold text-zinc-100">{title}</p>
                      <ul className="mt-2 space-y-2 text-xs text-zinc-200">
                        {bullets.map((item, bIdx) => (
                          <li key={`step-${idx}-bullet-${bIdx}`} className="flex gap-2">
                            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ListPanel title="Key Points" items={keyPoints} />
              <ListPanel title="Bullish Points" items={bullishPoints} />
              <ListPanel title="Bearish Points" items={bearishPoints} />
              <ListPanel title="Contradictions / Divergences" items={contradictions} />
              <ListPanel title="Volume Insights" items={volumeInsights} />
              <ListPanel title="Momentum Insights" items={momentumInsights} />
              <ListPanel title="Risk Signals" items={riskSignals} />
              <ListPanel title="What to Watch Next" items={watchNext} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
