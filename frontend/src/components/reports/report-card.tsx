import Link from "next/link";

import type { DbReportSummary } from "@/lib/reports-db";
import { FriendlyDate } from "./friendly-date";
import { VisibilityToggle } from "./visibility-toggle";

// Allowed values: Strong Buy | Buy | Hold | Sell | Strong Sell
function recommendationTone(rec: string | null): { label: string; cls: string } {
  switch (String(rec || "").trim().toLowerCase()) {
    case "strong buy":
      return { label: "Strong Buy", cls: "border-emerald-400/60 bg-emerald-500/15 text-emerald-100" };
    case "buy":
      return { label: "Buy", cls: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100" };
    case "hold":
      return { label: "Hold", cls: "border-white/20 bg-white/10 text-zinc-100" };
    case "sell":
      return { label: "Sell", cls: "border-red-300/40 bg-red-400/10 text-red-100" };
    case "strong sell":
      return { label: "Strong Sell", cls: "border-red-400/60 bg-red-500/15 text-red-100" };
    default:
      return { label: "—", cls: "border-white/15 bg-white/5 text-zinc-300" };
  }
}

export function ReportCard({
  report,
  showVisibilityToggle = false,
}: {
  report: DbReportSummary;
  showVisibilityToggle?: boolean;
}) {
  const href = `/dashboard/${encodeURIComponent(report.ticker)}/summary?report=${encodeURIComponent(report.id)}`;
  const rec = recommendationTone(report.recommendation);
  const company = report.company_name || report.ticker;

  return (
    <article className="group relative flex h-full flex-col rounded-2xl border border-white/10 bg-zinc-950/70 transition hover:border-emerald-400/50 hover:bg-emerald-500/5">
      {showVisibilityToggle ? (
        <div className="absolute right-3 top-3 z-10">
          <VisibilityToggle reportId={report.id} variant="icon" />
        </div>
      ) : null}
      <Link href={href} className="flex h-full flex-col justify-between p-5">
        <div>
          <p className="font-display text-3xl text-zinc-100">{report.ticker}</p>
          <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{company}</p>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${rec.cls}`}
          >
            {rec.label}
          </span>
          <FriendlyDate iso={report.generated_at} className="text-xs text-zinc-400" />
        </div>
      </Link>
    </article>
  );
}
