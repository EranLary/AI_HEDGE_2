"use client";

import Link from "next/link";
import { Menu, Plus } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { AuthMenu } from "@/components/shell/auth-menu";
import { useTickerContext } from "@/components/shell/ticker-context";
import { useNewRunModal } from "@/components/shell/new-run-context";

const SECTION_LABELS: Record<string, string> = {
  overview: "Overview",
  valuation: "Valuation",
  scenarios: "Bull vs Bear",
  assumptions: "Assumptions",
  "dream-team": "Dream Team",
  artifacts: "Artifacts",
};

type TopbarProps = {
  onMobileMenu?: () => void;
};

export function Topbar({ onMobileMenu }: TopbarProps) {
  const { activeTicker, activeSection } = useTickerContext();
  const { open: openNewRun } = useNewRunModal();

  const sectionLabel = activeSection ? SECTION_LABELS[activeSection] || activeSection : null;

  return (
    <header className="hib-topbar sticky top-0 z-30 flex items-center justify-between gap-3 px-3 py-2 sm:px-6">
      <div className="flex items-center gap-2 min-w-0">
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
        <nav className="hib-breadcrumb flex items-center gap-1.5 truncate text-xs uppercase tracking-[0.14em]">
          <Link href="/" className="hover:text-zinc-100">
            Home
          </Link>
          {activeTicker ? (
            <>
              <span>/</span>
              <Link href={`/dashboard/${encodeURIComponent(activeTicker)}/overview`} className="hover:text-zinc-100">
                <strong>{activeTicker}</strong>
              </Link>
            </>
          ) : null}
          {sectionLabel ? (
            <>
              <span>/</span>
              <strong>{sectionLabel}</strong>
            </>
          ) : null}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openNewRun}
          className="hib-run-btn inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-500/30"
          aria-label="Start a new analysis run"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">New Run</span>
        </button>
        <ThemeToggle />
        <AuthMenu />
      </div>
    </header>
  );
}
