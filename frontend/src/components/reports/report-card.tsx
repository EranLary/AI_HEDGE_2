import Link from "next/link";

import type { DbReportSummary } from "@/lib/reports-db";
import { DeleteReportButton } from "./delete-report-button";
import { FriendlyDate } from "./friendly-date";
import { VisibilityToggle } from "./visibility-toggle";

function scoreTone(score: number | null): { label: string; cls: string } {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return { label: "Score N/A", cls: "border-white/15 bg-white/5 text-zinc-300" };
  }
  if (score > 0) {
    return { label: `Score ${score.toFixed(2)}`, cls: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100" };
  }
  if (score < 0) {
    return { label: `Score ${score.toFixed(2)}`, cls: "border-red-300/40 bg-red-400/10 text-red-100" };
  }
  return { label: "Score 0.00", cls: "border-white/20 bg-white/10 text-zinc-100" };
}

export function ReportCard({
  report,
  showVisibilityToggle = false,
  showDeleteAction = false,
}: {
  report: DbReportSummary;
  showVisibilityToggle?: boolean;
  showDeleteAction?: boolean;
}) {
  const href = `/dashboard/${encodeURIComponent(report.ticker)}/summary?report=${encodeURIComponent(report.id)}`;
  const score = scoreTone(report.score);
  const company = report.company_name || report.ticker;

  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-white/10 bg-zinc-950/70 transition hover:border-emerald-400/50 hover:bg-emerald-500/5">
      {showVisibilityToggle ? (
        <div className="absolute right-3 top-3 z-10">
          <VisibilityToggle reportId={report.id} variant="icon" />
        </div>
      ) : null}
      {showDeleteAction ? (
        <div className="absolute right-12 top-3 z-10">
          <DeleteReportButton reportId={report.id} />
        </div>
      ) : null}
      <Link href={href} className="flex h-full flex-col justify-between p-5">
        <div>
          <p className="font-display text-3xl text-zinc-100">{report.ticker}</p>
          <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{company}</p>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${score.cls}`}
          >
            {score.label}
          </span>
          <FriendlyDate iso={report.generated_at} className="text-xs text-zinc-400" />
        </div>
      </Link>
    </article>
  );
}
