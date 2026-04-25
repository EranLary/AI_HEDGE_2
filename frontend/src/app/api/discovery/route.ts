import path from "node:path";

import { NextResponse } from "next/server";

import { DashboardPayload, DiscoveryRow } from "@/lib/dashboard-types";
import { listDashboardsForDiscovery } from "@/lib/reports-db";
import { listDashboardFiles, readJson } from "@/lib/server-outputs";

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function avgNums(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function decisionFromReturn(returnPct: number): { label: "Buy" | "Sell" | "Hold"; tone: "buy" | "sell" | "hold" } {
  if (returnPct > 5) return { label: "Buy", tone: "buy" };
  if (returnPct < -5) return { label: "Sell", tone: "sell" };
  return { label: "Hold", tone: "hold" };
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
    const decision = decisionFromReturn(returnPct);

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
