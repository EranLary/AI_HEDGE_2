"use client";

import { ReportChipRow } from "@/components/dashboard-chrome";
import type { ReportListItem } from "@/lib/dashboard-types";
import type { ResearchAudit } from "@/lib/research-audit-db";

function text(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function AuditClient({
  ticker,
  audit,
  reports,
  currentReportId,
}: {
  ticker: string;
  audit: ResearchAudit | null;
  reports: ReportListItem[];
  currentReportId: string;
}) {
  if (!audit) {
    return (
      <div>
        <ReportChipRow ticker={ticker} reports={reports} currentReportId={currentReportId} />
        <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-5">
          <h1 className="font-display text-2xl text-[color:var(--text-primary)]">Research Audit</h1>
          <p className="mt-2 text-sm text-[color:var(--text-muted)]">
            This report predates the structured research harness, so no claim ledger is available.
          </p>
        </section>
      </div>
    );
  }

  const warning = audit.run.quality_status !== "green";
  return (
    <div>
      <ReportChipRow ticker={ticker} reports={reports} currentReportId={currentReportId} />
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-[color:var(--text-primary)]">Research Audit</h1>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            Immutable facts, assumptions, evidence, contradictions, and execution lineage.
          </p>
        </div>
        <div className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${warning ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]" : "border-[color:var(--accent)] text-[color:var(--success)]"}`}>
          {audit.run.engine_id} / {audit.run.quality_status}
        </div>
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Claims", audit.claims.length],
          ["Evidence", audit.evidence.length],
          ["Sources", audit.sources.length],
          ["Contradictions", audit.contradictions.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
            <div className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">{label}</div>
            <div className="mt-1 font-mono text-2xl text-[color:var(--text-primary)]">{value}</div>
          </div>
        ))}
      </section>

      {warning ? (
        <section className="mb-5 rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-4 text-sm text-[color:var(--warning)]">
          <p>This report is not eligible for automated downstream use.</p>
          {audit.run.quality_notes.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {audit.run.quality_notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="space-y-4">
        <AuditSection title="Claims" rows={audit.claims} summary={(row) => `${text(row.kind)} / ${text(row.canonical_key)} / ${text(row.status)}`} />
        <AuditSection title="Contradictions and sensitivity inputs" rows={[...audit.contradictions, ...audit.sensitivity_scenarios]} summary={(row) => `${text(row.canonical_key)} / ${text(row.status || row.impact_status)}`} />
        <AuditSection title="Evidence" rows={audit.evidence} summary={(row) => `${text(row.locator)} / quality ${text(row.evidence_quality)}`} />
        <AuditSection title="Sources" rows={audit.sources} summary={(row) => `${text(row.source_type)} / ${text(row.title || row.canonical_uri)}`} />
        <AuditSection title="Execution manifest" rows={audit.stages} summary={(row) => `${text(row.stage_key)} / ${text(row.status)} / ${text(row.duration_ms)}ms`} />
      </div>
    </div>
  );
}

function AuditSection({
  title,
  rows,
  summary,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  summary: (row: Record<string, unknown>) => string;
}) {
  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <h2 className="font-display text-lg text-[color:var(--text-primary)]">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.map((row, index) => (
          <details key={String(row.id || index)} className="rounded-lg border border-[color:var(--border-subtle)] p-3">
            <summary className="cursor-pointer text-sm font-medium text-[color:var(--text-secondary)]">{summary(row)}</summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-[color:var(--text-muted)]">{JSON.stringify(row, null, 2)}</pre>
          </details>
        )) : <p className="text-sm text-[color:var(--text-muted)]">No records.</p>}
      </div>
    </section>
  );
}
