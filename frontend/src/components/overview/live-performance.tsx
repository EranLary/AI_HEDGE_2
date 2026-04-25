import { Suspense } from "react";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { getLivePerformance } from "@/lib/dashboard-server";

type Returns = NonNullable<DashboardPayload["header"]["price_performance_pct"]> | null;

const COLUMNS = ["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;

function fmtPct(v?: number | null): string {
  return typeof v === "number" && Number.isFinite(v)
    ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
    : "N/A";
}

function PerformanceGrid({ rows, loading }: { rows: Returns; loading?: boolean }) {
  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
      <p className="text-zinc-500">Price Performance</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4 xl:grid-cols-8">
        {COLUMNS.map((key) => {
          const value = rows?.[key];
          return (
            <div key={key} className="hib-perf-cell rounded-md px-2 py-1.5">
              <span className="block text-[10px] uppercase tracking-[0.12em] text-zinc-500">{key}</span>
              {loading ? (
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400">
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
                  Loading
                </span>
              ) : (
                <span
                  className={`mt-1 block text-sm font-semibold ${
                    typeof value === "number" && Number.isFinite(value) && Math.abs(value) > 1e-9
                      ? value > 0
                        ? "hib-target-up"
                        : "hib-target-down"
                      : "text-zinc-200"
                  }`}
                >
                  {typeof value === "number" && Number.isFinite(value) ? fmtPct(value) : "N/A"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function LivePerformanceInner({ ticker, fallback }: { ticker: string; fallback: Returns }) {
  const live = await getLivePerformance(ticker).catch(() => null);
  const rows = (live?.returns_pct as Returns) ?? fallback;
  return <PerformanceGrid rows={rows} />;
}

export function LivePerformanceIsland({
  ticker,
  fallback,
}: {
  ticker: string;
  fallback: Returns;
}) {
  return (
    <Suspense fallback={<PerformanceGrid rows={fallback} />}>
      <LivePerformanceInner ticker={ticker} fallback={fallback} />
    </Suspense>
  );
}
