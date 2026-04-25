"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useDashboardPayload } from "@/lib/use-dashboard-payload";
import { DashboardError, DashboardSkeleton, ReportChipRow } from "@/components/dashboard-chrome";

function ScenarioColumn({
  title,
  tone,
  reasons,
  probability,
  doc,
}: {
  title: string;
  tone: "bull" | "bear";
  reasons: string[];
  probability: number | null;
  doc?: { company?: string; document_type?: string; reasons?: string[] } | undefined;
}) {
  const borderCls = tone === "bull" ? "border-emerald-400/35 bg-emerald-500/6" : "border-red-400/35 bg-red-500/6";
  const dotCls = tone === "bull" ? "bg-emerald-400" : "bg-red-400";
  const probClass = tone === "bull" ? "hib-bull-prob-label" : "hib-bear-prob-label";
  const probValueClass = tone === "bull" ? "hib-bull-prob-value" : "hib-bear-prob-value";
  const items = reasons.length ? reasons : doc?.reasons || [];

  return (
    <section className={`rounded-2xl border p-4 ${borderCls}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg">{title}</h2>
        {typeof probability === "number" ? (
          <div className="text-right">
            <p className={`text-[10px] uppercase tracking-[0.18em] ${probClass}`}>Probability</p>
            <p className={`text-xl font-bold ${probValueClass}`}>
              {(Math.max(0, Math.min(100, Math.abs(probability) <= 1 ? probability * 100 : probability))).toFixed(1)}%
            </p>
          </div>
        ) : null}
      </div>
      {items.length ? (
        <ul className="space-y-2 text-sm text-zinc-200">
          {items.map((reason, idx) => (
            <li key={`${tone}-${idx}`} className="flex gap-2">
              <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dotCls}`} />
              <span className="hib-inline-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>
                  {String(reason || "").replace(/~~/g, "")}
                </ReactMarkdown>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No {title.toLowerCase()} reasons in this report.</p>
      )}
    </section>
  );
}

export default function DashboardScenariosPage({
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

  const matrix = data.analysis_matrix || { bull_case_reasons: [], bear_case_reasons: [], documents: undefined };
  const bullReasons = matrix.bull_case_reasons || matrix.documents?.bull_case?.reasons || [];
  const bearReasons = matrix.bear_case_reasons || matrix.documents?.bear_case?.reasons || [];

  // Derive probabilities from assumptions metric_means when present
  const metricMeans = data.valuation_hub.all_values?.metric_means || [];
  function probFor(label: string): number | null {
    const normalized = (s: string) => s.toLowerCase().replace(/[_/]/g, " ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const target = normalized(label);
    const hit = metricMeans.find((m) => normalized(m.label || m.metric_key) === target);
    return hit && typeof hit.mean === "number" ? hit.mean : null;
  }
  const bullProb = probFor("Bull Probability") ?? probFor("Bull 0");
  const bearProb = probFor("Bear Probability") ?? probFor("Bear 0");

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />
      <header className="mb-4">
        <h1 className="font-display text-2xl text-zinc-100">Bull vs Bear</h1>
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{upper} — scenario comparison</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <ScenarioColumn title="Bull Case" tone="bull" reasons={bullReasons} probability={bullProb} doc={matrix.documents?.bull_case} />
        <ScenarioColumn title="Bear Case" tone="bear" reasons={bearReasons} probability={bearProb} doc={matrix.documents?.bear_case} />
      </div>
    </div>
  );
}
