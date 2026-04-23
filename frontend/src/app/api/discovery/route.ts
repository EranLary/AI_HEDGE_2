import path from "node:path";

import { NextResponse } from "next/server";

import { DashboardPayload, DiscoveryRow } from "@/lib/dashboard-types";
import { listDashboardFiles, readJson } from "@/lib/server-outputs";

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  const now = Date.now();
  const last24hMs = 24 * 60 * 60 * 1000;
  const files = listDashboardFiles().filter((f) => now - f.mtimeMs <= last24hMs);

  const rows: DiscoveryRow[] = [];
  for (const item of files) {
    const payload = readJson<DashboardPayload>(item.path);
    if (!payload) {
      continue;
    }
    const current = safeNum(payload.valuation_hub?.consensus?.current_price);
    const mean = safeNum(payload.valuation_hub?.consensus?.mean_target_price);
    if (!current || !mean) {
      continue;
    }
    const marginSafety = ((mean - current) / current) * 100;
    const overvaluation = ((current - mean) / current) * 100;
    const dispersion = safeNum(payload.valuation_hub?.consensus?.cv);

    rows.push({
      ticker: payload.ticker,
      company_name: payload.header?.company_name || payload.ticker || path.basename(item.path),
      margin_safety_pct: marginSafety,
      overvaluation_pct: overvaluation,
      dispersion,
      updated_at: new Date(item.mtimeMs).toISOString(),
    });
  }

  const topGems = [...rows].sort((a, b) => b.margin_safety_pct - a.margin_safety_pct).slice(0, 10);
  const bubbles = [...rows].sort((a, b) => b.overvaluation_pct - a.overvaluation_pct).slice(0, 10);
  const highConviction = [...rows].sort((a, b) => a.dispersion - b.dispersion).slice(0, 10);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    window_hours: 24,
    count: rows.length,
    top_gems: topGems,
    bubbles,
    high_conviction: highConviction,
  });
}

