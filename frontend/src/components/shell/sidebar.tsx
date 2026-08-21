"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileText,
  GitCompareArrows,
  ScanSearch,
  Target,
  Plus,
  Play,
} from "lucide-react";
import type { ComponentType } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { TickerCombobox } from "@/components/shell/ticker-combobox";
import { ActiveRunsPanel } from "@/components/shell/active-runs-panel";
import { useNewRunModal } from "@/components/shell/new-run-context";
import { useNasdaqRunModal } from "@/components/shell/nasdaq-run-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthMenu } from "@/components/shell/auth-menu";
import { useWorkspace } from "@/components/shell/workspace-context";

type NavItem = {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
};

const GLOBAL_NAV: NavItem[] = [
  { path: "/reports", label: "Reports", icon: FileText },
  { path: "/compare", label: "Compare", icon: GitCompareArrows },
  { path: "/screeners", label: "Screeners", icon: ScanSearch },
  { path: "/discovery", label: "Discovery", icon: Compass },
  { path: "/hit-rate", label: "Track Record", icon: Target },
];

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onMobileClose?: () => void;
};

export function Sidebar({ collapsed, onToggle, mobile = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname() || "/";
  const { open: openNewRun } = useNewRunModal();
  const { access: nasdaqAccess, liveRun: nasdaqLiveRun, open: openNasdaqRun } = useNasdaqRunModal();
  const { workspace, href } = useWorkspace();
  const closeIfMobile = mobile ? onMobileClose : undefined;

  const collapsedDesktop = collapsed && !mobile;

  const handleNewAnalysis = () => {
    closeIfMobile?.();
    openNewRun();
  };

  const handleNasdaqRun = () => {
    closeIfMobile?.();
    openNasdaqRun();
  };

  return (
    <aside
      className={`hib-sidebar flex h-full flex-col ${
        collapsedDesktop ? "w-16" : "w-64"
      } transition-[width] duration-200`}
    >
      {/* Brand */}
      <div className="flex items-center justify-between gap-2 px-3 py-4">
        <Link
          href={href("/reports")}
          onClick={closeIfMobile}
          className="flex items-center gap-2 overflow-hidden"
          aria-label="Home"
        >
          <BrandLogo size={32} priority className="shrink-0" />
          {!collapsedDesktop ? (
            <span className="font-display text-sm leading-tight">
              <span className="block text-zinc-100">Hedge</span>
              <span className="block text-[10px] uppercase tracking-[0.22em] text-zinc-500">in a box</span>
            </span>
          ) : null}
        </Link>
        {!mobile ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hib-sidebar-item hidden h-8 w-8 items-center justify-center rounded-lg md:inline-flex"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {/* Workspace-specific primary action */}
        {workspace === "analysis" || nasdaqAccess?.isAdmin ? (
          <div className="mb-4 px-1">
            <button
              type="button"
              onClick={workspace === "analysis" ? handleNewAnalysis : handleNasdaqRun}
              aria-label={workspace === "analysis" ? "Start a new analysis" : "Run Nasdaq 100 universe"}
              title={workspace === "analysis" ? "Start a new analysis" : "Run Nasdaq 100 universe"}
              className={`hib-run-btn flex items-center gap-2 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-500/30 ${
                collapsedDesktop ? "h-9 w-9 justify-center px-0" : "w-full justify-center"
              }`}
            >
              {workspace === "analysis" ? <Plus size={14} /> : <Play size={14} />}
              {!collapsedDesktop ? <span>{workspace === "analysis" ? "New Analysis" : "Run"}</span> : null}
            </button>
            {workspace === "nasdaq100" && nasdaqLiveRun && !collapsedDesktop ? (
              <p className="mt-1 text-center text-[10px] text-[color:var(--text-muted)]">
                {nasdaqLiveRun.completedCount}/{nasdaqLiveRun.requestedCount} complete
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Ticker picker */}
        <div className="mb-4 px-1">
          {!collapsedDesktop ? (
            <p className="hib-sidebar-heading mb-1 px-2 text-[10px] uppercase tracking-[0.16em]">Ticker</p>
          ) : null}
          <TickerCombobox collapsed={collapsedDesktop} onCollapsedClick={onToggle} />
        </div>

        {/* Global nav */}
        <div className="mb-4">
          {!collapsedDesktop ? (
            <p className="hib-sidebar-heading mb-1 px-3 text-[10px] uppercase tracking-[0.16em]">Navigate</p>
          ) : null}
          <nav className="space-y-1">
            {GLOBAL_NAV.filter((item) => workspace === "analysis" || item.path !== "/compare").map((item) => {
              const itemHref = href(item.path);
              const active = pathname === itemHref || pathname.startsWith(`${itemHref}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  href={itemHref}
                  onClick={closeIfMobile}
                  className={`hib-sidebar-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                    active ? "hib-sidebar-item-active" : ""
                  }`}
                  title={item.label}
                >
                  <Icon size={14} />
                  {!collapsedDesktop ? <span className="truncate">{item.label}</span> : null}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Active runs mini-panel */}
        {workspace === "analysis" && !collapsedDesktop ? (
          <div className="mt-4 px-1">
            <ActiveRunsPanel />
          </div>
        ) : workspace === "analysis" ? (
          <div className="mt-4 flex justify-center">
            <ActiveRunsPanel collapsed />
          </div>
        ) : null}
      </div>

      {!collapsedDesktop ? (
        <div className="hib-sidebar-heading border-t border-white/5 px-4 py-3 text-[10px] uppercase tracking-[0.14em]">
          <div className="flex items-center justify-between gap-2">
            <span>
              <Activity size={10} className="mr-1 inline" />
              <span>AI valuation</span>
            </span>
            {mobile ? (
              <div className="flex items-center gap-2 normal-case tracking-normal">
                <ThemeToggle className="h-8 px-2 py-1.5" />
                <AuthMenu menuDirection="up" />
              </div>
            ) : (
              <ThemeToggle />
            )}
          </div>
        </div>
      ) : null}

      {mobile ? (
        <button
          type="button"
          onClick={onMobileClose}
          className="border-t border-white/10 px-4 py-3 text-center text-xs text-zinc-400 hover:text-zinc-100"
        >
          Close menu
        </button>
      ) : null}
    </aside>
  );
}
