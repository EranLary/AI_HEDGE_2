"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Gem, Radar, ShieldAlert } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

import type { DiscoveryRow } from "@/lib/dashboard-types";

type DiscoveryPayload = {
  generated_at: string;
  window_hours: number | null;
  count: number;
  top_undervalued: DiscoveryRow[];
  top_overvalued: DiscoveryRow[];
  top_conviction: DiscoveryRow[];
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
  metricLabel: "return" | "confidence";
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
      </div>
      <div className="space-y-2">
            {rows.length ? (
              rows.map((row, idx) => (
            <div key={`${title}-${row.ticker}-${row.updated_at}-${idx}`} className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">#{idx + 1} {row.ticker}</p>
                  <p className="text-xs text-zinc-500">{row.company_name}</p>
                </div>
                <Link
                  href={`/dashboard?ticker=${row.ticker}`}
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
                ) : (
                  <div>
                    <p className="text-zinc-500">Confidence (CV)</p>
                    <p className={accent}>{Number.isFinite(row.confidence_cv) ? row.confidence_cv.toFixed(3) : "N/A"}</p>
                    <p className={`mt-1 font-semibold ${decisionClass(row.decision_tone)}`}>
                      {row.decision_label || "Hold"}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-zinc-500">Updated</p>
                  <p className="text-zinc-200">{new Date(row.updated_at).toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No runs in the selected 24-hour window.</p>
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
    <div className="hib-shell min-h-screen px-4 py-6 text-zinc-100 sm:px-8">
      <div className="mx-auto w-full max-w-[1400px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
          <div>
            <h1 className="font-display text-2xl">Market Discovery</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">All Reports (Latest Per Ticker)</p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-100 transition hover:border-emerald-400/50 hover:bg-emerald-500/10"
          >
            Back to Dashboard
          </Link>
          <ThemeToggle />
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
              Scanned {data.count} latest dashboards (one per ticker). Generated at {new Date(data.generated_at).toLocaleString()}.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
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
                icon={<Radar size={16} className="text-cyan-300" />}
                rows={data.top_conviction}
                accent="text-cyan-300"
                metricLabel="confidence"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
