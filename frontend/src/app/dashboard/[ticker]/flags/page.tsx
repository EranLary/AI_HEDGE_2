"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";

import { useDashboardPayload } from "@/lib/use-dashboard-payload";
import { DashboardError, DashboardSkeleton, ReportChipRow } from "@/components/dashboard-chrome";

function fmtPct(v?: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function SwotQuad({
  swot,
}: {
  swot?: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
}) {
  if (!swot) return null;
  const any =
    (swot.strengths?.length || 0) +
    (swot.weaknesses?.length || 0) +
    (swot.opportunities?.length || 0) +
    (swot.threats?.length || 0);
  if (!any) return null;

  const quad = [
    { key: "strengths", label: "Strengths", items: swot.strengths || [], tone: "text-emerald-200 border-emerald-400/30" },
    { key: "weaknesses", label: "Weaknesses", items: swot.weaknesses || [], tone: "text-red-200 border-red-400/30" },
    { key: "opportunities", label: "Opportunities", items: swot.opportunities || [], tone: "text-cyan-200 border-cyan-400/30" },
    { key: "threats", label: "Threats", items: swot.threats || [], tone: "text-amber-200 border-amber-400/30" },
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">SWOT</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {quad.map((q) => (
          <div key={q.key} className={`rounded-xl border p-3 ${q.tone}`}>
            <p className="mb-1 text-[10px] uppercase tracking-[0.18em]">{q.label}</p>
            {q.items.length ? (
              <ul className="space-y-1 text-sm">
                {q.items.map((item, idx) => (
                  <li key={`${q.key}-${idx}`}>• {item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">None noted.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DashboardFlagsPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const upper = decodeURIComponent(ticker).toUpperCase();
  const search = useSearchParams();
  const reportId = search?.get("report") || undefined;
  const { data, loading, error, reportsForTicker, resolvedReportId } = useDashboardPayload(upper, reportId);

  if (loading && !data) return <DashboardSkeleton />;
  if (!data) return <DashboardError error={error || "No data"} ticker={upper} />;

  const shieldFlags = (data.red_flag_shield || []).filter(Boolean);
  const forensicFlags = (data.forecast_forensic_matrix?.forensic_flags || []).filter(Boolean);
  const shift = data.analysis_matrix?.structural_shift;
  const swot = data.analysis_matrix?.swot;
  const insights = data.analysis_matrix?.red_flag_insights || [];

  const nothing =
    !shieldFlags.length && !forensicFlags.length && !shift?.triggered && !swot && !insights.length;

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4">
        <h1 className="font-display text-2xl text-zinc-100">Flags & Risks</h1>
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{upper} — risk surface</p>
      </header>

      {shift?.triggered ? (
        <section
          className={`mb-4 flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${
            shift.direction === "up"
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
              : "border-red-400/40 bg-red-500/10 text-red-100"
          }`}
        >
          {shift.direction === "up" ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          <div>
            <p className="font-semibold uppercase tracking-[0.14em]">Structural shift ({shift.direction})</p>
            <p className="text-xs opacity-85">
              52-week change {typeof shift.change_pct_52w === "number" ? fmtPct(shift.change_pct_52w) : "N/A"}
            </p>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="hib-flag-card rounded-2xl border p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={14} />
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em]">Red Flag Shield ({shieldFlags.length})</h2>
          </div>
          {shieldFlags.length ? (
            <ul className="space-y-2 text-sm">
              {shieldFlags.map((f, idx) => (
                <li key={`shield-${idx}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs opacity-70">No red flags detected.</p>
          )}
        </section>

        <section className="rounded-2xl border border-amber-400/30 bg-amber-500/8 p-4 text-amber-100">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={14} />
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em]">Forensic Forecast Flags ({forensicFlags.length})</h2>
          </div>
          {forensicFlags.length ? (
            <ul className="space-y-2 text-sm">
              {forensicFlags.map((f, idx) => (
                <li key={`forensic-${idx}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs opacity-80">No forensic flags.</p>
          )}
        </section>
      </div>

      {insights.length ? (
        <section className="mt-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">Red-flag Insights</h2>
          <ul className="space-y-2 text-sm text-zinc-200">
            {insights.map((s, idx) => (
              <li key={`insight-${idx}`} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-4">
        <SwotQuad swot={swot} />
      </div>

      {nothing ? (
        <p className="mt-6 text-sm text-zinc-400">This report is clean — no flags, shifts, or SWOT entries were recorded.</p>
      ) : null}
    </div>
  );
}
