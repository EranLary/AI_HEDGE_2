"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BarChart3, CandlestickChart, Check, ChevronDown, Download, FileText, Menu, Scale, Users } from "lucide-react";
import type { ComponentType } from "react";

import { AuthMenu } from "@/components/shell/auth-menu";
import { useTickerContext } from "@/components/shell/ticker-context";
import type { ReportListItem } from "@/lib/dashboard-types";

type SectionItem = { slug: string; label: string; icon: ComponentType<{ size?: number }> };

const SECTIONS: SectionItem[] = [
  { slug: "overview", label: "Overview", icon: FileText },
  { slug: "valuation", label: "Valuation", icon: BarChart3 },
  { slug: "scenarios", label: "Bull vs Bear", icon: Scale },
  { slug: "technical-analysis", label: "Technical Analysis", icon: CandlestickChart },
  { slug: "dream-team", label: "Dream Team", icon: Users },
];

type TopbarProps = {
  onMobileMenu?: () => void;
};

export function Topbar({ onMobileMenu }: TopbarProps) {
  const { activeTicker, activeSection } = useTickerContext();

  return (
    <header className="hib-topbar sticky top-0 z-30 flex items-center gap-3 px-3 py-2 sm:px-6">
      <div className="flex shrink-0 items-center gap-2">
        {onMobileMenu ? (
          <button
            type="button"
            onClick={onMobileMenu}
            aria-label="Open menu"
            className="hib-auth-btn inline-flex h-9 w-9 items-center justify-center rounded-lg md:hidden"
          >
            <Menu size={16} />
          </button>
        ) : null}
        {activeTicker ? (
          <Suspense fallback={<TickerBadge activeTicker={activeTicker} suffix="" />}>
            <TickerBadgeWithReport activeTicker={activeTicker} />
          </Suspense>
        ) : (
          <Link href="/" className="hib-breadcrumb text-xs uppercase tracking-[0.14em] hover:text-zinc-100">
            Home
          </Link>
        )}
      </div>

      {activeTicker ? (
        <Suspense fallback={<div className="min-w-0 flex-1" />}>
          <SectionPills activeTicker={activeTicker} activeSection={activeSection} />
        </Suspense>
      ) : (
        <div className="min-w-0 flex-1" />
      )}

      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <AuthMenu />
      </div>
    </header>
  );
}

function TickerBadge({ activeTicker, suffix }: { activeTicker: string; suffix: string }) {
  return (
    <Link
      href={`/dashboard/${encodeURIComponent(activeTicker)}/summary${suffix}`}
      className="hib-breadcrumb inline-flex items-center rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
    >
      <strong>{activeTicker}</strong>
    </Link>
  );
}

function TickerBadgeWithReport({ activeTicker }: { activeTicker: string }) {
  const search = useSearchParams();
  const reportParam = search?.get("report");
  const suffix = reportParam ? `?report=${encodeURIComponent(reportParam)}` : "";
  return <TickerBadge activeTicker={activeTicker} suffix={suffix} />;
}

function SectionPills({
  activeTicker,
  activeSection,
}: {
  activeTicker: string;
  activeSection: string | null;
}) {
  const search = useSearchParams();
  const reportParam = search?.get("report");
  const suffix = reportParam ? `?report=${encodeURIComponent(reportParam)}` : "";

  return (
    <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 px-1 sm:gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:gap-2">
        {SECTIONS.map((s) => {
          const active = activeSection === s.slug;
          const href = `/dashboard/${encodeURIComponent(activeTicker)}/${s.slug}${suffix}`;
          const Icon = s.icon;
          return (
            <Link
              key={s.slug}
              href={href}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                active
                  ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                  : "border-white/15 bg-white/5 text-zinc-300 hover:border-white/30 hover:text-zinc-100"
              }`}
            >
              <Icon size={12} />
              <span>{s.label}</span>
            </Link>
          );
        })}
      </div>
      <PdfDownloadMenu activeTicker={activeTicker} reportParam={reportParam} />
    </nav>
  );
}

function reportTimestamp(report: ReportListItem): number {
  const raw = String(report.generated_at || report.updated_at || "");
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function fmtReportLabel(report: ReportListItem): string {
  const ts = new Date(report.generated_at || report.updated_at || "");
  if (!Number.isFinite(ts.getTime())) return String(report.report_id || "").slice(0, 8);
  return ts.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function PdfDownloadMenu({ activeTicker, reportParam }: { activeTicker: string; reportParam: string | null }) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ticker = String(activeTicker || "").toUpperCase();
    if (!ticker) {
      setReports([]);
      return;
    }
    let alive = true;
    fetch("/api/reports", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        const rows = Array.isArray(json?.reports) ? (json.reports as ReportListItem[]) : [];
        const filtered = rows
          .filter((row) => String(row.ticker || "").toUpperCase() === ticker)
          .sort((a, b) => reportTimestamp(b) - reportTimestamp(a));
        setReports(filtered);
      })
      .catch(() => {
        if (alive) setReports([]);
      });
    return () => {
      alive = false;
    };
  }, [activeTicker]);

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

  const current = useMemo(() => {
    const explicit = reportParam ? reports.find((r) => r.report_id === reportParam) : null;
    return explicit || reports[0] || null;
  }, [reportParam, reports]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition hover:border-white/30 hover:text-zinc-100"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Download size={12} />
        <span>PDF</span>
        <ChevronDown size={11} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur"
        >
          {reports.length ? (
            reports.map((report) => {
              const selected = current ? report.report_id === current.report_id : false;
              const href = `/api/artifacts/${encodeURIComponent(activeTicker)}/analysis-pdf?report_id=${encodeURIComponent(report.report_id)}`;
              return (
                <a
                  key={report.report_id}
                  role="option"
                  aria-selected={selected}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition ${
                    selected
                      ? "bg-emerald-500/10 text-emerald-100"
                      : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                  }`}
                >
                  <span className="font-mono">{fmtReportLabel(report)}</span>
                  {selected ? <Check size={13} className="text-emerald-300" aria-hidden /> : null}
                </a>
              );
            })
          ) : (
            <a
              href={`/api/artifacts/${encodeURIComponent(activeTicker)}/analysis-pdf`}
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs text-zinc-300 transition hover:bg-white/5 hover:text-zinc-100"
            >
              <span>Latest report PDF</span>
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
