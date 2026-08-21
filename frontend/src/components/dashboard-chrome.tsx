"use client";

import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReportListItem } from "@/lib/dashboard-types";
import { useWorkspace } from "@/components/shell/workspace-context";

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

function fmtScore(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "N/A";
}

function scoreToneClass(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) <= 1e-9) return "text-zinc-300";
  return value > 0 ? "hib-target-up" : "hib-target-down";
}

export function DashboardSkeleton({ message }: { message?: string }) {
  return (
    <div>
      <div className="mb-3 text-xs uppercase tracking-[0.14em] text-zinc-500">{message || "Loading dashboard..."}</div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/5" />
        ))}
      </div>
    </div>
  );
}

export function ReportChipRow({
  ticker,
  reports,
  currentReportId,
}: {
  ticker: string;
  reports: ReportListItem[];
  currentReportId: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (reports.length <= 1) return null;
  const current = reports.find((r) => r.report_id === currentReportId) || reports[0];

  return (
    <section className="mb-4 rounded-xl border border-white/10 bg-zinc-950/70 p-3">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] font-medium text-zinc-300 backdrop-blur transition hover:border-white/30 hover:text-zinc-100"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">{ticker} · Report</span>
          <span className="font-mono text-[11px] text-zinc-100">
            {fmtDateTimeNoSeconds(String(current.generated_at || current.updated_at || ""))}
          </span>
          <span className={`font-mono text-[11px] font-semibold ${scoreToneClass(current.score)}`}>
            {fmtScore(current.score)}
          </span>
          <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />
        </button>

        {open ? (
          <div
            role="listbox"
            className="absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur"
          >
            {reports.map((report) => {
              const active = report.report_id === currentReportId;
              const nextParams = new URLSearchParams(params?.toString() || "");
              nextParams.set("report", report.report_id);
              return (
                <button
                  key={report.report_id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    router.replace(`?${nextParams.toString()}`, { scroll: false });
                    setOpen(false);
                  }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition ${
                  active
                    ? "bg-emerald-500/10 text-emerald-100"
                    : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                }`}
              >
                <span className="font-mono">{fmtDateTimeNoSeconds(String(report.generated_at || report.updated_at || ""))}</span>
                <span className={`font-mono font-semibold ${scoreToneClass(report.score)}`}>{fmtScore(report.score)}</span>
                {active ? <Check size={13} className="text-emerald-300" aria-hidden /> : null}
              </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">Newest to oldest</div>
    </section>
  );
}

export function DashboardError({ error, ticker }: { error: string; ticker: string }) {
  const { href } = useWorkspace();
  return (
    <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-100">
      <p className="font-semibold">{error}</p>
      <p className="mt-1 text-xs">No data for {ticker}.</p>
      <Link href={href("/reports")} className="mt-3 inline-block rounded border border-white/30 px-2 py-1 text-xs">
        Back to dashboards
      </Link>
    </div>
  );
}
