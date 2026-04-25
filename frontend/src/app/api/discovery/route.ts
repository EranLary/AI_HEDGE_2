import path from "node:path";

import { NextResponse } from "next/server";

import { DashboardPayload, DiscoveryRow } from "@/lib/dashboard-types";
import { listDashboardsForDiscovery } from "@/lib/reports-db";
import { listDashboardFiles, readJson } from "@/lib/server-outputs";

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeNumOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avgNums(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function decisionFromAdjustedScore(adjustedScore: number): {
  label: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
  tone: "buy" | "sell" | "hold";
} {
  if (adjustedScore >= 15) return { label: "Strong Buy", tone: "buy" };
  if (adjustedScore >= 7) return { label: "Buy", tone: "buy" };
  if (adjustedScore > -7) return { label: "Hold", tone: "hold" };
  if (adjustedScore > -15) return { label: "Sell", tone: "sell" };
  return { label: "Strong Sell", tone: "sell" };
}

async function loadDashboards(): Promise<
  Array<{ ticker: string; payload: DashboardPayload; updatedAt: string; sourceLabel: string }>
> {
  try {
    const dbRows = await listDashboardsForDiscovery();
    if (dbRows.length) {
      return dbRows.map((r) => ({
        ticker: String(r.ticker).toUpperCase(),
        payload: r.dashboard as DashboardPayload,
        updatedAt: new Date(r.generated_at).toISOString(),
        sourceLabel: r.ticker,
      }));
    }
  } catch (err) {
    console.warn("[discovery] DB read failed:", err);
  }
  const files = listDashboardFiles().sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files
    .map((item) => {
      const payload = readJson<DashboardPayload>(item.path);
      if (!payload) return null;
      return {
        ticker: String(payload.ticker || "").toUpperCase(),
        payload,
        updatedAt: new Date(item.mtimeMs).toISOString(),
        sourceLabel: item.path,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

export async function GET() {
  const items = await loadDashboards();

  const rows: DiscoveryRow[] = [];
  const seenTickers = new Set<string>();
  for (const item of items) {
    const payload = item.payload;
    if (!payload) {
      continue;
    }
    const ticker = item.ticker;
    if (!ticker || seenTickers.has(ticker)) {
      continue;
    }

    const current = safeNum(payload.valuation_hub?.consensus?.current_price);
    const mean = safeNum(payload.valuation_hub?.consensus?.mean_target_price);
    if (!current || !mean) {
      continue;
    }
    const returnPct = ((mean - current) / current) * 100;
    const overvaluation = ((current - mean) / current) * 100;
    const priceCvRaw = safeNum(payload.valuation_hub?.consensus?.cv);
    const investmentCvRaw = Array.isArray(payload.valuation_hub?.consensus?.lmil)
      ? safeNum(payload.valuation_hub?.consensus?.lmil?.[1])
      : 0;
    const cvParts = [Math.abs(priceCvRaw), Math.abs(investmentCvRaw)].filter(
      (v) => Number.isFinite(v) && v > 0,
    );
    const confidenceCv = cvParts.length ? avgNums(cvParts) : Number.POSITIVE_INFINITY;
    const positionPct = safeNumOrNull(payload.decision_card?.position_size_pct_of_notional);
    const combinedScore =
      safeNumOrNull(payload.decision_card?.combined_score) ?? combinedDecisionScore(positionPct, returnPct);
    const overallCv =
      safeNumOrNull(payload.decision_card?.overall_cv) ??
      (Number.isFinite(confidenceCv) ? confidenceCv : null);
    const adjustedScore =
      safeNumOrNull(payload.decision_card?.adjusted_score) ??
      confidenceAdjustedScore(combinedScore, overallCv);
    const decision = decisionFromAdjustedScore(
      typeof adjustedScore === "number" && Number.isFinite(adjustedScore) ? adjustedScore : 0,
    );

    rows.push({
      ticker,
      company_name: payload.header?.company_name || ticker || path.basename(item.sourceLabel),
      margin_safety_pct: returnPct,
      overvaluation_pct: overvaluation,
      dispersion: confidenceCv,
      return_pct: returnPct,
      confidence_cv: confidenceCv,
      decision_label: decision.label,
      decision_tone: decision.tone,
      updated_at: item.updatedAt,
    });
    seenTickers.add(ticker);
  }

  const topUndervalued = [...rows]
    .filter((row) => row.return_pct > 0)
    .sort((a, b) => b.return_pct - a.return_pct)
    .slice(0, 10);

  const topOvervalued = [...rows]
    .filter((row) => row.return_pct < 0)
    .sort((a, b) => a.return_pct - b.return_pct)
    .slice(0, 10);

  const topConviction = [...rows]
    .sort((a, b) => a.confidence_cv - b.confidence_cv)
    .slice(0, 10);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    window_hours: null,
    count: rows.length,
    top_undervalued: topUndervalued,
    top_overvalued: topOvervalued,
    top_conviction: topConviction,
    // Backward-compatible aliases.
    top_gems: topUndervalued,
    bubbles: topOvervalued,
    high_conviction: topConviction,
  });
}
