import { NextResponse } from "next/server";

import { buildDiscoveryPayload } from "@/lib/discovery-core";
import { buildDiscoveryPerformancePayload } from "@/lib/discovery-performance";
import { getSql } from "@/lib/db";

type DiscoveryLensType = "overall" | "model" | "valuator";

type LensItem = {
  type: DiscoveryLensType;
  key: string;
  label: string;
};

type PerfPoint = {
  date: string;
  nav: number;
  cumulative_return_pct: number;
};

type PerfSeries = {
  key: string;
  label: string;
  points: PerfPoint[];
};

type CombinedSeries = {
  key: string;
  label: string;
  points: PerfPoint[];
  sourceLens: string;
};

export async function GET() {
  try {
    const overallPerf = await buildDiscoveryPerformancePayload({ lensType: "overall", refresh: true });
    const sql = getSql();

    const lenses: LensItem[] = [{ type: "overall", key: "", label: "Overall" }];
    if (sql) {
      const rows = (await sql`
        SELECT DISTINCT lens_type, lens_key
          FROM discovery_strategy_nav
         WHERE lens_type IN ('model', 'valuator')
           AND lens_key <> '__overall__'
         ORDER BY lens_type ASC, lens_key ASC
      `) as unknown as Array<{ lens_type: string; lens_key: string }>;
      for (const row of rows) {
        const lensType = String(row.lens_type || "").trim().toLowerCase();
        const lensKey = String(row.lens_key || "").trim();
        if (!lensKey) continue;
        if (lensType === "model") {
          lenses.push({ type: "model", key: lensKey, label: `Model: ${lensKey}` });
        } else if (lensType === "valuator") {
          lenses.push({ type: "valuator", key: lensKey, label: `Valuator: ${lensKey}` });
        }
      }
    }

    // Backfill lens list on first run when DB has not tracked model/valuator keys yet.
    if (lenses.length <= 1) {
      const discovery = await buildDiscoveryPayload({ lensType: "overall", lensKey: null });
      for (const m of discovery.lens_options.models || []) {
        lenses.push({ type: "model", key: m, label: `Model: ${m}` });
      }
      for (const v of discovery.lens_options.valuators || []) {
        lenses.push({ type: "valuator", key: v, label: `Valuator: ${v}` });
      }
    }

    const lensPayloads = await Promise.all(
      lenses.slice(1).map(async (lens) => {
        const payload = await buildDiscoveryPerformancePayload({
          lensType: lens.type,
          lensKey: lens.key,
          refresh: false,
        });
        return { lens, payload };
      }),
    );

    const combined: CombinedSeries[] = [];

    for (const line of overallPerf.series as PerfSeries[]) {
      const compositeKey = `overall::${line.key}`;
      combined.push({
        key: compositeKey,
        label: line.key === "benchmark_sp500" ? line.label : `${line.label} - Overall`,
        points: line.points,
        sourceLens: "Overall",
      });
    }

    for (const entry of lensPayloads) {
      const lensLabel = entry.lens.label;
      const lines = (entry.payload.series || []) as PerfSeries[];
      for (const line of lines) {
        if (line.key === "benchmark_sp500") continue;
        const compositeKey = `${entry.lens.type}:${entry.lens.key}::${line.key}`;
        combined.push({
          key: compositeKey,
          label: `${line.label} - ${lensLabel}`,
          points: line.points,
          sourceLens: lensLabel,
        });
      }
    }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      windows: overallPerf.windows,
      series: combined,
      line_count: combined.length,
      lens_count: lenses.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json(
      { error: "observatory_failed", message },
      { status: 500 },
    );
  }
}
