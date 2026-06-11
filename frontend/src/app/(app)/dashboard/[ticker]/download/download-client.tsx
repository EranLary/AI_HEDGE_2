"use client";

import { Download } from "lucide-react";

import { ReportChipRow } from "@/components/dashboard-chrome";
import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";

type DownloadItem = {
  key: string;
  title: string;
  fileLabel: string;
  href: string;
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

  const items: DownloadItem[] = [
    {
      key: "analysis",
      title: "Analysis",
      fileLabel: `${upper}_analysis_${dateStamp}.pdf`,
      href: downloads.analysis_pdf || `/api/artifacts/${encodeURIComponent(upper)}/analysis-pdf`,
    },
    {
      key: "valuation",
      title: "Valuation",
      fileLabel: `${upper}_valuation_${dateStamp}.pdf`,
      href: downloads.valuation_pdf || downloads.prices_explain_pdf || `/api/artifacts/${encodeURIComponent(upper)}/valuation-pdf`,
    },
    {
      key: "combined",
      title: "Combined",
      fileLabel: `${upper}_combined_${dateStamp}.pdf`,
      href: downloads.combined_pdf || `/api/artifacts/${encodeURIComponent(upper)}/combined-pdf`,
    },
  ];

  return (
    <div>
      <ReportChipRow ticker={upper} reports={reportsForTicker} currentReportId={resolvedReportId} />

      <header className="mb-4">
        <h1 className="font-display text-2xl text-[color:var(--text-primary)]">Download</h1>
        <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
          {upper} report files
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {items.map((item) => {
          return (
            <a
              key={item.key}
              href={item.href}
              className="group flex min-h-36 flex-col justify-between rounded-lg border border-white/10 bg-zinc-950/70 p-4 transition hover:border-emerald-400/50 hover:bg-emerald-500/5"
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold text-[color:var(--text-primary)]">{item.title}</span>
                  <span className="mt-1 block break-all font-mono text-xs text-[color:var(--text-muted)]">
                    {item.fileLabel}
                  </span>
                </span>
              </span>
              <span className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">
                <Download size={13} />
                Download PDF
              </span>
            </a>
          );
        })}
      </section>
    </div>
  );
}
