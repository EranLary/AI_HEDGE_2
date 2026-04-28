"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Gem, Radar, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";

import type { DiscoveryRow } from "@/lib/dashboard-types";

function fmtDateTimeNoSeconds(value: string): string {
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "N/A";
  return dt.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type DiscoveryPayload = {
  generated_at: string;
  window_hours: number | null;
  count: number;
  top_undervalued: DiscoveryRow[];
  top_overvalued: DiscoveryRow[];
  top_conviction: DiscoveryRow[];
  top_highest_allocation: DiscoveryRow[];
  top_lowest_allocation: DiscoveryRow[];
};

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function decisionClass(tone?: DiscoveryRow["decision_tone"]): string {
  if (tone === "buy") return "hib-signal-buy";
  if (tone === "sell") return "hib-signal-sell";
  return "hib-signal-hold";
}

function SectionCard({
  title,
  icon,
  rows,
  accent,
  metricLabel,
}: {
  title: string;
  icon: ReactNode;
  rows: DiscoveryRow[];
  accent: string;
  metricLabel: "return" | "disagreement" | "allocation";
}) {
  const [topN, setTopN] = useState<10 | 20>(10);
  const shownRows = rows.slice(0, topN);
  const canShow20 = rows.length > 10;

  return (
    <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
        </div>
        {canShow20 ? (
          <div className="inline-flex rounded-md border border-white/15 bg-white/5 p-0.5 text-[10px] uppercase tracking-[0.12em]">
            <button
              type="button"
              onClick={() => setTopN(10)}
              className={`rounded px-2 py-1 transition ${topN === 10 ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"}`}
            >
              Top 10
            </button>
            <button
              type="button"
              onClick={() => setTopN(20)}
              className={`rounded px-2 py-1 transition ${topN === 20 ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"}`}
            >
              Top 20
            </button>
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
            {shownRows.length ? (
              shownRows.map((row, idx) => (
            <div key={`${title}-${row.ticker}-${row.updated_at}-${idx}`} className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">#{idx + 1} {row.ticker}</p>
                  <p className="text-xs text-zinc-500">{row.company_name}</p>
                </div>
                <Link
                  href={`/dashboard/${encodeURIComponent(row.ticker)}/overview`}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-zinc-200 transition hover:border-emerald-300/60 hover:bg-emerald-500/10"
                >
                  Open
                </Link>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {metricLabel === "return" ? (
                  <div>
                    <p className="text-zinc-500">Return</p>
                    <p className={accent}>{fmtPct(row.return_pct)}</p>
                  </div>
                ) : metricLabel === "allocation" ? (
                  <div>
                    <p className="text-zinc-500">Allocation</p>
                    <p className={accent}>
                      {typeof row.investment_allocation_pct === "number" && Number.isFinite(row.investment_allocation_pct)
                        ? fmtPct(row.investment_allocation_pct)
                        : "N/A"}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-zinc-500">Disagreement Score</p>
                    <p className={accent}>{Number.isFinite(row.confidence_cv) ? row.confidence_cv.toFixed(3) : "N/A"}</p>
                    <p className={`mt-1 font-semibold ${decisionClass(row.decision_tone)}`}>
                      {row.decision_label || "Hold"}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-zinc-500">Updated</p>
                  <p className="text-zinc-200">{fmtDateTimeNoSeconds(String(row.updated_at || ""))}</p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No rows available.</p>
        )}
      </div>
    </article>
  );
}

export default function DiscoveryPage() {
  const [data, setData] = useState<DiscoveryPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch("/api/discovery", { cache: "no-store" });
        const json = (await res.json()) as DiscoveryPayload;
        if (!cancelled) {
          setData(json);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 text-zinc-100 sm:px-8">
      <div>
        <header className="mb-6 rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
          <h1 className="font-display text-2xl">Market Discovery</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">All Reports (Latest Per Ticker)</p>
        </header>

        {loading || !data ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-40 animate-pulse rounded-xl border border-white/10 bg-white/5" />
            ))}
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-zinc-400">
              Scanned {data.count} latest dashboards (one per ticker). Generated at {fmtDateTimeNoSeconds(String(data.generated_at || ""))}.
            </p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SectionCard
                title="Most Undervalued"
                icon={<Gem size={16} className="text-emerald-400" />}
                rows={data.top_undervalued}
                accent="text-emerald-300"
                metricLabel="return"
              />
              <SectionCard
                title="Most Overvalued"
                icon={<ShieldAlert size={16} className="text-red-400" />}
                rows={data.top_overvalued}
                accent="text-red-300"
                metricLabel="return"
              />
              <SectionCard
                title="Top Conviction"
                icon={<Radar size={16} className="hib-conviction-accent" />}
                rows={data.top_conviction}
                accent="hib-conviction-accent"
                metricLabel="disagreement"
              />
              <SectionCard
                title="Highest Allocation"
                icon={<TrendingUp size={16} className="text-emerald-400" />}
                rows={data.top_highest_allocation}
                accent="text-emerald-300"
                metricLabel="allocation"
              />
              <SectionCard
                title="Lowest Allocation"
                icon={<TrendingDown size={16} className="text-red-400" />}
                rows={data.top_lowest_allocation}
                accent="text-red-300"
                metricLabel="allocation"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
