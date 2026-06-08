"use client";

import { FileText, ShieldCheck } from "lucide-react";

import { ReportChipRow } from "@/components/dashboard-chrome";
import { SmallCopyButton } from "@/components/hedge-dashboard";
import type { DashboardPayload, ReportListItem, SecQnaPayload } from "@/lib/dashboard-types";

type SecAnswer = NonNullable<SecQnaPayload["answers"]>[number];

function cleanText(value: unknown): string {
  return String(value || "").replace(/~~/g, "").trim();
}

function confidenceClass(confidence: string): string {
  const normalized = confidence.toLowerCase();
  if (normalized === "high") return "border-[color:var(--success)] text-[color:var(--success)]";
  if (normalized === "medium") return "border-[color:var(--warning)] text-[color:var(--warning)]";
  if (normalized === "low") return "border-[color:var(--text-muted)] text-[color:var(--text-muted)]";
  return "border-[color:var(--border-strong)] text-[color:var(--text-muted)]";
}

function answerCopyText(row: SecAnswer, index: number): string {
  const refs = Array.isArray(row.filing_refs) ? row.filing_refs.filter(Boolean).join(", ") : "";
  return [
    `${index}. ${cleanText(row.question)}`,
    "",
    cleanText(row.answer),
    row.evidence ? `Evidence: ${cleanText(row.evidence)}` : "",
    refs ? `Filing refs: ${refs}` : "",
    row.confidence ? `Confidence: ${cleanText(row.confidence)}` : "",
  ].filter(Boolean).join("\n");
}

function buildAllCopyText(rows: SecAnswer[]): string {
  return rows.map((row, idx) => answerCopyText(row, idx + 1)).join("\n\n");
}

function EmptySecQa({ status, error }: { status: string; error: string }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[color:var(--text-muted)]">
          <FileText size={16} />
        </div>
        <div>
          <h2 className="font-display text-lg text-[color:var(--text-primary)]">SEC Q&A unavailable</h2>
          <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
            {error || (status === "unavailable" ? "This report was generated before the SEC Q&A dashboard tab was added." : "No filing Q&A was generated for this report.")}
          </p>
        </div>
      </div>
    </section>
  );
}

export type SecQaClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

export function SecQaClient({
  ticker,
  data,
  reportsForTicker,
  resolvedReportId,
}: SecQaClientProps) {
  const upper = ticker;
  const secQna = data.sec_qna || {};
  const rows = Array.isArray(secQna.answers) ? secQna.answers : [];
  const errors = Array.isArray(secQna.errors) ? secQna.errors.filter(Boolean) : [];
  const status = cleanText(secQna.status || "unavailable");
  const allCopyText = buildAllCopyText(rows);

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-[color:var(--text-primary)]">SEC Q&A</h1>
          <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">{upper} - filing diligence</p>
        </div>
        {rows.length ? (
          <SmallCopyButton text={allCopyText} label="Copy SEC Q&A" iconOnly />
        ) : null}
      </header>

      {!rows.length ? (
        <EmptySecQa status={status} error={errors[0] || ""} />
      ) : (
        <div className="space-y-3">
          {rows.map((row, idx) => {
            const question = cleanText(row.question) || "Question unavailable";
            const answer = cleanText(row.answer) || "Not disclosed in the provided filings.";
            const evidence = cleanText(row.evidence);
            const confidence = cleanText(row.confidence);
            const refs = Array.isArray(row.filing_refs) ? row.filing_refs.filter(Boolean) : [];

            return (
              <article key={`${question}-${idx}`} className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-[color:var(--text-muted)]">
                      {idx + 1}
                    </div>
                    <h2 className="min-w-0 text-base font-semibold leading-snug text-[color:var(--text-primary)]">{question}</h2>
                  </div>
                  <SmallCopyButton text={answerCopyText(row, idx + 1)} label={`Copy SEC Q&A ${idx + 1}`} iconOnly />
                </div>

                <div className="space-y-3 pl-0 sm:pl-11">
                  <p className="text-sm leading-relaxed text-[color:var(--text-secondary)]">{answer}</p>

                  {evidence ? (
                    <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-3">
                      <p className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
                        <ShieldCheck size={12} />
                        Evidence
                      </p>
                      <p className="text-xs leading-relaxed text-[color:var(--text-secondary)]">{evidence}</p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {confidence ? (
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${confidenceClass(confidence)}`}>
                        {confidence}
                      </span>
                    ) : null}
                    {refs.map((ref) => (
                      <span key={ref} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-[color:var(--text-muted)]">
                        {ref}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
