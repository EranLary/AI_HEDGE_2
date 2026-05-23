"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { ReportChipRow } from "@/components/dashboard-chrome";
import { SmallCopyButton } from "@/components/hedge-dashboard";

type SwotData = {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
};

function SwotAccordion({ swot }: { swot: SwotData }) {
  const [open, setOpen] = useState(false);
  const sections: Array<{ key: keyof SwotData; label: string; tone: string }> = [
    { key: "strengths", label: "Strengths", tone: "border-emerald-400/30 bg-emerald-500/5" },
    { key: "weaknesses", label: "Weaknesses", tone: "border-red-400/30 bg-red-500/5" },
    { key: "opportunities", label: "Opportunities", tone: "border-emerald-400/30 bg-emerald-500/5" },
    { key: "threats", label: "Threats", tone: "border-red-400/30 bg-red-500/5" },
  ];
  const totalCount = sections.reduce((acc, s) => acc + (swot[s.key]?.length || 0), 0);
  if (!totalCount) return null;

  return (
    <section className="mb-4 rounded-2xl border border-white/10 bg-zinc-950/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-300">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Strategic Position (SWOT) <span className="text-zinc-500">— {totalCount} items</span>
        </span>
      </button>
      {open ? (
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
          {sections.map((s) => {
            const items = swot[s.key] || [];
            if (!items.length) return null;
            return (
              <div key={s.key} className={`rounded-xl border p-3 ${s.tone}`}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-300">{s.label}</p>
                <ul className="space-y-1.5 text-xs text-zinc-200">
                  {items.map((it, idx) => (
                    <li key={`${s.key}-${idx}`} className="flex gap-2">
                      <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-zinc-400" />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

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
  const copyText = [
    typeof probability === "number"
      ? `Probability: ${(Math.max(0, Math.min(100, Math.abs(probability) <= 1 ? probability * 100 : probability))).toFixed(1)}%`
      : "Probability: N/A",
    "",
    ...items.map((reason, idx) => `${idx + 1}. ${String(reason || "").replace(/~~/g, "").trim()}`),
  ].join("\n").trim();

  return (
    <section className={`rounded-2xl border p-4 ${borderCls}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg">{title}</h2>
        <div className="flex items-center gap-2">
          <SmallCopyButton text={copyText} label={`Copy ${title}`} iconOnly />
          {typeof probability === "number" ? (
            <div className="text-right">
              <p className={`text-[10px] uppercase tracking-[0.18em] ${probClass}`}>Probability</p>
              <p className={`text-xl font-bold ${probValueClass}`}>
                {(Math.max(0, Math.min(100, Math.abs(probability) <= 1 ? probability * 100 : probability))).toFixed(1)}%
              </p>
            </div>
          ) : null}
        </div>
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

export type ScenariosClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

export function ScenariosClient({
  ticker,
  data,
  reportsForTicker,
  resolvedReportId,
}: ScenariosClientProps) {
  const upper = ticker;
  const matrix = data.analysis_matrix || { bull_case_reasons: [], bear_case_reasons: [], documents: undefined };
  const bullReasons = matrix.bull_case_reasons || matrix.documents?.bull_case?.reasons || [];
  const bearReasons = matrix.bear_case_reasons || matrix.documents?.bear_case?.reasons || [];

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
      <SwotAccordion
        swot={
          (matrix.swot as SwotData | undefined) || {
            strengths: [],
            weaknesses: [],
            opportunities: [],
            threats: [],
          }
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ScenarioColumn title="Bull Case" tone="bull" reasons={bullReasons} probability={bullProb} doc={matrix.documents?.bull_case} />
        <ScenarioColumn title="Bear Case" tone="bear" reasons={bearReasons} probability={bearProb} doc={matrix.documents?.bear_case} />
      </div>
    </div>
  );
}
