"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BarChart3, CandlestickChart, Download, FileText, Menu, Scale, Users } from "lucide-react";
import type { ComponentType } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { AuthMenu } from "@/components/shell/auth-menu";
import { useTickerContext } from "@/components/shell/ticker-context";

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
        <ThemeToggle />
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
    <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 sm:gap-2">
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
      <a
        href={`/api/artifacts/${encodeURIComponent(activeTicker)}/analysis-pdf`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition hover:border-white/30 hover:text-zinc-100"
      >
        <Download size={12} />
        <span>PDF</span>
      </a>
    </nav>
  );
}
