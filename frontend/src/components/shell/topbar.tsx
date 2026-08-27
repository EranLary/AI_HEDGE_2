"use client";

import { Suspense, useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { useSearchParams } from "next/navigation";
import { BarChart3, Calculator, CandlestickChart, Download, FileQuestion, FileText, Globe2, Info, Landmark, LoaderCircle, Menu, Scale, Store, Users } from "lucide-react";
import type { ComponentType } from "react";

import { AuthMenu } from "@/components/shell/auth-menu";
import { useTickerContext } from "@/components/shell/ticker-context";
import { WorkspaceBar } from "@/components/shell/workspace-bar";
import type { ReportListItem } from "@/lib/dashboard-types";
import { useWorkspace } from "@/components/shell/workspace-context";
import { workspacePath, type Workspace } from "@/lib/workspace";

type SectionItem = { slug: string; label: string; icon: ComponentType<{ size?: number }> };

const SECTIONS: SectionItem[] = [
  { slug: "info", label: "Info", icon: Info },
  { slug: "overview", label: "Overview", icon: FileText },
  { slug: "valuation", label: "Valuation", icon: BarChart3 },
  { slug: "financials", label: "Financials", icon: Calculator },
  { slug: "market", label: "Market", icon: Store },
  { slug: "web-search", label: "Web Search", icon: Globe2 },
  { slug: "scenarios", label: "Bull vs Bear", icon: Scale },
  { slug: "sec-qa", label: "SEC Q&A", icon: FileQuestion },
  { slug: "wall-st", label: "WALL ST.", icon: Landmark },
  { slug: "technical-analysis", label: "Technical Analysis", icon: CandlestickChart },
  { slug: "dream-team", label: "Dream Team", icon: Users },
  { slug: "download", label: "Download", icon: Download },
];

type TopbarProps = {
  onMobileMenu?: () => void;
};

function SectionPillContent({ item }: { item: SectionItem }) {
  const { pending } = useLinkStatus();
  const Icon = item.icon;

  return (
    <span className="inline-flex items-center gap-1.5" aria-busy={pending || undefined}>
      {pending ? <LoaderCircle size={12} className="animate-spin" aria-hidden /> : <Icon size={12} />}
      <span>{item.label}</span>
      {pending ? <span className="sr-only"> loading</span> : null}
    </span>
  );
}

export function Topbar({ onMobileMenu }: TopbarProps) {
  const { activeTicker, activeSection } = useTickerContext();
  const { workspace } = useWorkspace();

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
          <Suspense fallback={<TickerBadge activeTicker={activeTicker} suffix="" score={null} workspace={workspace} />}>
            <TickerBadgeWithReport activeTicker={activeTicker} workspace={workspace} />
          </Suspense>
        ) : null}
      </div>

      {activeTicker ? (
        <Suspense fallback={<div className="min-w-0 flex-1" />}>
          <SectionPills activeTicker={activeTicker} activeSection={activeSection} workspace={workspace} />
        </Suspense>
      ) : (
        <WorkspaceBar />
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

function TickerBadge({ activeTicker, suffix, score, workspace = "analysis" }: { activeTicker: string; suffix: string; score?: number | null; workspace?: Workspace }) {
  return (
    <Link
      href={`${workspacePath(workspace, `/dashboard/${encodeURIComponent(activeTicker)}/summary`)}${suffix}`}
      className={`hib-breadcrumb inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ring-sky-300/70 ring-offset-1 ring-offset-zinc-950 ${scoreBadgeClass(score)}`}
    >
      <strong>{activeTicker}</strong>
    </Link>
  );
}

function TickerBadgeWithReport({ activeTicker, workspace }: { activeTicker: string; workspace: Workspace }) {
  const search = useSearchParams();
  const reportParam = search?.get("report");
  const suffix = reportParam ? `?report=${encodeURIComponent(reportParam)}` : "";
  const [reports, setReports] = useState<ReportListItem[]>([]);

  useEffect(() => {
    let canceled = false;
    fetch(`/api/reports?workspace=${workspace}`, { cache: "no-store" })
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
  }, [workspace]);

  const tickerReports = reports.filter((r) => String(r.ticker || "").toUpperCase() === activeTicker.toUpperCase());
  const current = reportParam
    ? tickerReports.find((r) => r.report_id === reportParam)
    : tickerReports[0];
  return <TickerBadge activeTicker={activeTicker} suffix={suffix} score={current?.score} workspace={workspace} />;
}

function SectionPills({
  activeTicker,
  activeSection,
  workspace,
}: {
  activeTicker: string;
  activeSection: string | null;
  workspace: Workspace;
}) {
  const search = useSearchParams();
  const reportParam = search?.get("report");
  const suffix = reportParam ? `?report=${encodeURIComponent(reportParam)}` : "";

  return (
    <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 px-1 sm:gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:gap-2">
        {SECTIONS.map((s) => {
          const active = activeSection === s.slug;
          const href = `${workspacePath(workspace, `/dashboard/${encodeURIComponent(activeTicker)}/${s.slug}`)}${suffix}`;
          return (
            <Link
              key={s.slug}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${
                active
                  ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                  : "border-white/15 bg-white/5 text-zinc-300 hover:border-white/30 hover:text-zinc-100"
              }`}
            >
              <SectionPillContent item={s} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
