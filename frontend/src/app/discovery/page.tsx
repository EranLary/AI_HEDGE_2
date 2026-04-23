"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Gem, Radar, ShieldAlert } from "lucide-react";

import type { DiscoveryRow } from "@/lib/dashboard-types";

type DiscoveryPayload = {
  generated_at: string;
  window_hours: number;
  count: number;
  top_gems: DiscoveryRow[];
  bubbles: DiscoveryRow[];
  high_conviction: DiscoveryRow[];
};

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function SectionCard({
  title,
  icon,
  rows,
  accent,
}: {
  title: string;
  icon: ReactNode;
  rows: DiscoveryRow[];
  accent: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
      </div>
      <div className="space-y-2">
        {rows.length ? (
          rows.map((row) => (
            <div key={`${title}-${row.ticker}`} className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{row.ticker}</p>
                  <p className="text-xs text-zinc-500">{row.company_name}</p>
                </div>
                <Link
                  href={`/dashboard?ticker=${row.ticker}`}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-zinc-200 transition hover:border-emerald-300/60 hover:bg-emerald-500/10"
                >
                  Open
                </Link>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-zinc-500">Margin Safety</p>
                  <p className={accent}>{fmtPct(row.margin_safety_pct)}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Overvaluation</p>
                  <p className="text-red-300">{fmtPct(row.overvaluation_pct)}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Dispersion</p>
                  <p className="text-zinc-100">{row.dispersion.toFixed(3)}</p>
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
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Last 24 Hours</p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-100 transition hover:border-emerald-400/50 hover:bg-emerald-500/10"
          >
            Back to Dashboard
          </Link>
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
              Scanned {data.count} dashboards. Generated at {new Date(data.generated_at).toLocaleString()}.
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <SectionCard
                title="Top Gems"
                icon={<Gem size={16} className="text-emerald-400" />}
                rows={data.top_gems}
                accent="text-emerald-300"
              />
              <SectionCard
                title="Bubbles"
                icon={<ShieldAlert size={16} className="text-red-400" />}
                rows={data.bubbles}
                accent="text-red-300"
              />
              <SectionCard
                title="High Conviction"
                icon={<Radar size={16} className="text-cyan-300" />}
                rows={data.high_conviction}
                accent="text-cyan-300"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
