"use client";

import { useState } from "react";

import { ReportChipRow } from "@/components/dashboard-chrome";
import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";

type DownloadItem = {
  key: "analysis" | "valuation" | "combined";
  title: string;
  description: string;
  htmlLabel: string;
  htmlHref: string;
  markdownLabel: string;
  markdownHref: string;
  pdfLabel: string;
  pdfHref: string;
};

function downloadDateStamp(value: unknown): string {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "report_date";
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = String(date.getFullYear()).slice(-2);
  return `${day}_${month}_${year}`;
}

export type DownloadClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
};

export function DownloadClient({
  ticker,
  data,
  reportsForTicker,
  resolvedReportId,
}: DownloadClientProps) {
  const upper = ticker.toUpperCase();
  const downloads = data.downloads || ({} as NonNullable<typeof data.downloads>);
  const dateStamp = downloadDateStamp(data.generated_at || data.report_mtime);
  const [preparingPdf, setPreparingPdf] = useState<DownloadItem["key"] | null>(null);
  const [downloadError, setDownloadError] = useState("");

  const items: DownloadItem[] = [
    {
      key: "analysis",
      title: "Analysis",
      description: "Company research, evidence, market context, risks, and the full analytical record.",
      htmlLabel: `${upper}_analysis_${dateStamp}.html`,
      htmlHref: downloads.analysis_html || `/api/artifacts/${encodeURIComponent(upper)}/analysis-html`,
      markdownLabel: `${upper}_analysis_${dateStamp}.md`,
      markdownHref: downloads.analysis_md || `/api/artifacts/${encodeURIComponent(upper)}/analysis-md`,
      pdfLabel: `${upper}_analysis_${dateStamp}.pdf`,
      pdfHref: downloads.analysis_pdf || `/api/artifacts/${encodeURIComponent(upper)}/analysis-pdf`,
    },
    {
      key: "valuation",
      title: "Valuation",
      description: "Target-price methods, assumptions, model outputs, consensus, and allocation context.",
      htmlLabel: `${upper}_valuation_${dateStamp}.html`,
      htmlHref: downloads.valuation_html || `/api/artifacts/${encodeURIComponent(upper)}/valuation-html`,
      markdownLabel: `${upper}_valuation_${dateStamp}.md`,
      markdownHref: downloads.valuation_md || `/api/artifacts/${encodeURIComponent(upper)}/valuation-md`,
      pdfLabel: `${upper}_valuation_${dateStamp}.pdf`,
      pdfHref: downloads.valuation_pdf || `/api/artifacts/${encodeURIComponent(upper)}/valuation-pdf`,
    },
    {
      key: "combined",
      title: "Combined",
      description: "The complete Analysis and Valuation report in one continuous, navigable document.",
      htmlLabel: `${upper}_combined_${dateStamp}.html`,
      htmlHref: downloads.combined_html || `/api/artifacts/${encodeURIComponent(upper)}/combined-html`,
      markdownLabel: `${upper}_combined_${dateStamp}.md`,
      markdownHref: downloads.combined_md || `/api/artifacts/${encodeURIComponent(upper)}/combined-md`,
      pdfLabel: `${upper}_combined_${dateStamp}.pdf`,
      pdfHref: downloads.combined_pdf || `/api/artifacts/${encodeURIComponent(upper)}/combined-pdf`,
    },
  ];

  async function downloadPdf(item: DownloadItem) {
    if (preparingPdf) return;
    setPreparingPdf(item.key);
    setDownloadError("");
    try {
      const response = await fetch(item.pdfHref, { cache: "no-store" });
      if (!response.ok) {
        let message = "Could not prepare the PDF.";
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          // Keep the concise fallback message for non-JSON failures.
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = item.pdfLabel;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not prepare the PDF.");
    } finally {
      setPreparingPdf(null);
    }
  }

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-5 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">
          HTML-first reports
        </p>
        <h1 className="mt-1 font-display text-3xl text-[color:var(--text-primary)]">Read or export</h1>
        <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
          Your research, your way.
        </p>
      </header>

      {downloadError ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[color:var(--danger)] bg-[color:var(--surface-elevated)] px-4 py-3 text-sm text-[color:var(--danger)]"
        >
          {downloadError}
        </p>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        {items.map((item) => {
          const isPreparing = preparingPdf === item.key;
          return (
            <article
              key={item.key}
              className="flex min-h-72 flex-col rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-5 shadow-sm transition hover:border-[color:var(--border-strong)]"
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-xl text-[color:var(--text-primary)]">{item.title}</h2>
                  <span className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                    Live HTML
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:var(--text-secondary)]">{item.description}</p>
                <p className="mt-4 break-all font-mono text-[0.7rem] text-[color:var(--text-muted)]">
                  {item.htmlLabel}
                </p>
              </div>

              <div className="mt-auto space-y-2 pt-6">
                <a
                  href={item.htmlHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center rounded-lg bg-[color:var(--accent)] px-3 py-2.5 text-sm font-semibold text-[color:var(--text-on-accent)] transition hover:bg-[color:var(--accent-hover)]"
                >
                  Open HTML report
                </a>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={item.markdownHref}
                    className="flex items-center justify-center rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-xs font-semibold text-[color:var(--text-secondary)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]"
                    download={item.markdownLabel}
                  >
                    Download for LLM
                  </a>
                  <button
                    type="button"
                    onClick={() => downloadPdf(item)}
                    disabled={Boolean(preparingPdf)}
                    aria-busy={isPreparing}
                    className="rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-xs font-semibold text-[color:var(--text-secondary)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
                  >
                    {isPreparing ? "Preparing PDF…" : "Download PDF"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
