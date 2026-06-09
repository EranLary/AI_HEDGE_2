"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BarChart3, CandlestickChart, Download, FileQuestion, FileText, Menu, Scale, Store, Users } from "lucide-react";
import type { ComponentType } from "react";

import { AuthMenu } from "@/components/shell/auth-menu";
import { useTickerContext } from "@/components/shell/ticker-context";
import type { ReportListItem } from "@/lib/dashboard-types";

type SectionItem = { slug: string; label: string; icon: ComponentType<{ size?: number }> };

const SECTIONS: SectionItem[] = [
  { slug: "overview", label: "Overview", icon: FileText },
  { slug: "valuation", label: "Valuation", icon: BarChart3 },
  { slug: "market", label: "Market", icon: Store },
  { slug: "scenarios", label: "Bull vs Bear", icon: Scale },
  { slug: "sec-qa", label: "SEC Q&A", icon: FileQuestion },
  { slug: "technical-analysis", label: "Technical Analysis", icon: CandlestickChart },
  { slug: "dream-team", label: "Dream Team", icon: Users },
  { slug: "download", label: "Download", icon: Download },
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
          <Suspense fallback={<TickerBadge activeTicker={activeTicker} suffix="" score={null} />}>
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

function scoreTone(value?: number | null): "up" | "down" | "neutral" {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) <= 1e-9) return "neutral";
  return value > 0 ? "up" : "down";
}

function scoreBadgeClass(value?: number | null): string {
  const tone = scoreTone(value);
  if (tone === "up") return "border-emerald-500/45 bg-emerald-500/10 text-emerald-100";
  if (tone === "down") return "border-red-500/45 bg-red-500/10 text-red-100";
  return "border-white/15 bg-white/5 text-zinc-100";
}

function TickerBadge({ activeTicker, suffix, score }: { activeTicker: string; suffix: string; score?: number | null }) {
  return (
    <Link
      href={`/dashboard/${encodeURIComponent(activeTicker)}/summary${suffix}`}
      className={`hib-breadcrumb inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ring-sky-300/70 ring-offset-1 ring-offset-zinc-950 ${scoreBadgeClass(score)}`}
    >
      <strong>{activeTicker}</strong>
      <span className="font-mono normal-case tracking-normal">
        {typeof score === "number" && Number.isFinite(score) ? score.toFixed(2) : "N/A"}
      </span>
    </Link>
  );
}

function TickerBadgeWithReport({ activeTicker }: { activeTicker: string }) {
  const search = useSearchParams();
  const reportParam = search?.get("report");
  const suffix = reportParam ? `?report=${encodeURIComponent(reportParam)}` : "";
  const [reports, setReports] = useState<ReportListItem[]>([]);

  useEffect(() => {
    let canceled = false;
    fetch("/api/reports", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((json) => {
        if (canceled) return;
        setReports(Array.isArray(json?.reports) ? (json.reports as ReportListItem[]) : []);
      })
      .catch(() => {
        if (!canceled) setReports([]);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const tickerReports = reports.filter((r) => String(r.ticker || "").toUpperCase() === activeTicker.toUpperCase());
  const current = reportParam
    ? tickerReports.find((r) => r.report_id === reportParam)
    : tickerReports[0];
  return <TickerBadge activeTicker={activeTicker} suffix={suffix} score={current?.score} />;
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
    </nav>
  );
}
