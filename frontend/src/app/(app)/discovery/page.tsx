"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Gem, Radar, ShieldAlert, Star, TrendingDown, TrendingUp } from "lucide-react";

import type { DiscoveryRow } from "@/lib/dashboard-types";
import { useWorkspace } from "@/components/shell/workspace-context";

type DiscoveryLensType = "overall" | "model" | "valuator";

type DiscoveryPayload = {
  generated_at: string;
  lens: {
    type: DiscoveryLensType;
    key: string | null;
    label: string;
  };
  lens_options: {
    models: string[];
    valuators: string[];
  };
  window_hours: number | null;
  count: number;
  top_undervalued: DiscoveryRow[];
  top_overvalued: DiscoveryRow[];
  top_conviction: DiscoveryRow[];
  lowest_conviction: DiscoveryRow[];
  top_highest_allocation: DiscoveryRow[];
  top_lowest_allocation: DiscoveryRow[];
  top_scores: DiscoveryRow[];
  lowest_scores: DiscoveryRow[];
};

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

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtScore(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function summaryScoreTone(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-[color:var(--text-muted)]";
  if (value > 0) return "text-[color:var(--success)]";
  if (value < 0) return "text-[color:var(--danger)]";
  return "text-[color:var(--text-secondary)]";
}

function SectionCard({
  title,
  icon,
  rows,
  accent,
  metricLabel,
  showSummaryScore = false,
}: {
  title: string;
  icon: ReactNode;
  rows: DiscoveryRow[];
  accent: string;
  metricLabel: "return" | "disagreement" | "allocation" | "score";
  showSummaryScore?: boolean;
}) {
  const { href } = useWorkspace();
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
                  href={href(`/dashboard/${encodeURIComponent(row.ticker)}/summary`)}
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
                ) : metricLabel === "score" ? (
                  <div>
                    <p className="text-zinc-500">Summary Score</p>
                    <p className={accent}>{fmtScore(row.points_score)}</p>
                  </div>
                ) : (
                  <div className={showSummaryScore ? "rounded-lg border border-white/10 bg-white/5 px-2.5 py-2" : undefined}>
                    <p className={showSummaryScore ? "min-h-8 text-zinc-500 leading-4" : "text-zinc-500"}>Disagreement Score</p>
                    <p className={`${accent} ${showSummaryScore ? "mt-2" : "mt-0.5"} font-semibold tabular-nums`}>
                      {Number.isFinite(row.confidence_cv) ? row.confidence_cv.toFixed(3) : "N/A"}
                    </p>
                  </div>
                )}
                {showSummaryScore ? (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2">
                    <p className="min-h-8 text-zinc-500 leading-4">Summary Score</p>
                    <p className={`${summaryScoreTone(row.points_score)} mt-2 font-semibold tabular-nums`}>
                      {fmtScore(row.points_score)}
                    </p>
                  </div>
                ) : null}
                <div className={showSummaryScore ? "col-span-2 flex flex-wrap items-center justify-between gap-1 border-t border-white/10 pt-2" : undefined}>
                  <p className="text-zinc-500">Updated</p>
                  <p className="text-zinc-200 tabular-nums">{fmtDateTimeNoSeconds(String(row.updated_at || ""))}</p>
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
  const { workspace, api } = useWorkspace();
  const [data, setData] = useState<DiscoveryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [lensType, setLensType] = useState<DiscoveryLensType>("overall");
  const [lensKey, setLensKey] = useState("");
  const initializedFromQueryRef = useRef(false);

  useEffect(() => {
    if (initializedFromQueryRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const rawType = String(params.get("lens_type") || "").trim().toLowerCase();
    const rawKey = String(params.get("lens_key") || "").trim();
    if (rawType === "model" || rawType === "valuator") {
      setLensType(rawType);
      setLensKey(rawKey);
      initializedFromQueryRef.current = true;
      return;
    }
    if (rawType === "overall") {
      setLensType("overall");
      setLensKey("");
      initializedFromQueryRef.current = true;
      return;
    }
    initializedFromQueryRef.current = true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("lens_type", lensType);
        if (lensType !== "overall" && lensKey.trim()) {
          params.set("lens_key", lensKey.trim());
        }
        const res = await fetch(api(`/api/discovery?${params.toString()}`), { cache: "no-store" });
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
  }, [api, lensType, lensKey, workspace]);

  const modelOptions = data?.lens_options.models || [];
  const valuatorOptions = data?.lens_options.valuators || [];
  const selectedOptions = lensType === "model" ? modelOptions : lensType === "valuator" ? valuatorOptions : [];

  const onLensTypeChange = (next: DiscoveryLensType) => {
    setLensType(next);
    if (next === "overall") {
      setLensKey("");
      return;
    }
    const pool = next === "model" ? modelOptions : valuatorOptions;
    setLensKey(pool[0] || "");
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 text-zinc-100 sm:px-8">
      <div>
        <header className="mb-6 rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
          <h1 className="font-display text-2xl">Market Discovery</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            <span className="block">Based On Reports From the</span>
            <span className="block">Last 3 Months</span>
          </p>
        </header>

        {loading || !data ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-40 animate-pulse rounded-xl border border-white/10 bg-white/5" />
            ))}
          </div>
        ) : (
          <>
            <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Discovery Lens</p>
                  <p className="text-sm font-semibold text-zinc-100">{data.lens.label}</p>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <div className="inline-flex rounded-xl border border-white/15 bg-white/5 p-1 text-xs uppercase tracking-[0.12em]">
                    <button
                      type="button"
                      onClick={() => onLensTypeChange("overall")}
                      className={`rounded-lg px-3 py-1.5 transition ${
                        lensType === "overall" ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"
                      }`}
                    >
                      Overall
                    </button>
                    <button
                      type="button"
                      onClick={() => onLensTypeChange("model")}
                      className={`rounded-lg px-3 py-1.5 transition ${
                        lensType === "model" ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                      disabled={!modelOptions.length}
                    >
                      Model
                    </button>
                    <button
                      type="button"
                      onClick={() => onLensTypeChange("valuator")}
                      className={`rounded-lg px-3 py-1.5 transition ${
                        lensType === "valuator" ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-300 hover:text-zinc-100"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                      disabled={!valuatorOptions.length}
                    >
                      Valuator
                    </button>
                  </div>
                  {lensType !== "overall" ? (
                    <select
                      value={lensKey}
                      onChange={(e) => setLensKey(String(e.target.value || ""))}
                      className="w-full min-w-[260px] rounded-lg border border-white/15 bg-zinc-950/80 px-3 py-2 text-base text-zinc-100 outline-none focus:border-emerald-400/60 sm:w-auto sm:text-sm"
                    >
                      {selectedOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>
            </section>
            <p className="mb-4 text-sm text-zinc-400">
              Scanned {data.count} tickers for this lens. Generated at {fmtDateTimeNoSeconds(String(data.generated_at || ""))}.
            </p>
            {workspace === "nasdaq100" && data.count === 0 ? (
              <div className="mb-4 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4 text-sm text-[color:var(--text-muted)]">
                Nasdaq 100 Discovery will appear as the first universe reports complete.
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SectionCard
                title="Top Scores"
                icon={<Star size={16} className="text-emerald-300" />}
                rows={data.top_scores}
                accent="text-emerald-300"
                metricLabel="score"
              />
              <SectionCard
                title="Most Undervalued"
                icon={<Gem size={16} className="text-emerald-400" />}
                rows={data.top_undervalued}
                accent="text-emerald-300"
                metricLabel="return"
              />
              <SectionCard
                title="Highest Allocation"
                icon={<TrendingUp size={16} className="text-emerald-400" />}
                rows={data.top_highest_allocation}
                accent="text-emerald-300"
                metricLabel="allocation"
              />
              <SectionCard
                title="Lowest Scores"
                icon={<Star size={16} className="text-red-300" />}
                rows={data.lowest_scores}
                accent="text-red-300"
                metricLabel="score"
              />
              <SectionCard
                title="Most Overvalued"
                icon={<ShieldAlert size={16} className="text-red-400" />}
                rows={data.top_overvalued}
                accent="text-red-300"
                metricLabel="return"
              />
              <SectionCard
                title="Lowest Allocation"
                icon={<TrendingDown size={16} className="text-red-400" />}
                rows={data.top_lowest_allocation}
                accent="text-red-300"
                metricLabel="allocation"
              />
              {lensType === "overall" ? (
                <>
                  <SectionCard
                    title="Top Conviction"
                    icon={<Radar size={16} className="hib-conviction-accent" />}
                    rows={data.top_conviction}
                    accent="hib-conviction-accent"
                    metricLabel="disagreement"
                    showSummaryScore
                  />
                  <SectionCard
                    title="Lowest Conviction"
                    icon={<Radar size={16} className="text-[color:var(--info)]" />}
                    rows={data.lowest_conviction}
                    accent="text-[color:var(--info)]"
                    metricLabel="disagreement"
                    showSummaryScore
                  />
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
