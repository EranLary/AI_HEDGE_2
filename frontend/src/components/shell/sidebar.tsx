"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Compass,
  Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";

import { TickerCombobox } from "@/components/shell/ticker-combobox";
import { ActiveRunsPanel } from "@/components/shell/active-runs-panel";
import { TickerWorkspace } from "@/components/shell/ticker-workspace";
import { useTickerContext } from "@/components/shell/ticker-context";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
};

const GLOBAL_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboards", icon: BarChart3 },
  { href: "/discovery", label: "Discovery", icon: Compass },
];

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onMobileClose?: () => void;
};

export function Sidebar({ collapsed, onToggle, mobile = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname() || "/";
  const { activeTicker } = useTickerContext();
  const closeIfMobile = mobile ? onMobileClose : undefined;

  const collapsedDesktop = collapsed && !mobile;

  return (
    <aside
      className={`hib-sidebar flex h-full flex-col ${
        collapsedDesktop ? "w-16" : "w-64"
      } transition-[width] duration-200`}
    >
      {/* Brand */}
      <div className="flex items-center justify-between gap-2 px-3 py-4">
        <Link
          href="/"
          onClick={closeIfMobile}
          className="flex items-center gap-2 overflow-hidden"
          aria-label="Home"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/15 text-emerald-200">
            <Sparkles size={14} />
          </span>
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
        {/* Ticker picker */}
        <div className="mb-4 px-1">
          {!collapsedDesktop ? (
            <p className="hib-sidebar-heading mb-1 px-2 text-[10px] uppercase tracking-[0.16em]">Ticker</p>
          ) : null}
          <TickerCombobox collapsed={collapsedDesktop} onCollapsedClick={onToggle} />
        </div>

        {/* Ticker workspace card (only when a ticker is active) */}
        {activeTicker ? (
          <div className="mb-4 px-1">
            <TickerWorkspace
              ticker={activeTicker}
              collapsed={collapsedDesktop}
              onNavigate={closeIfMobile}
            />
          </div>
        ) : null}

        {/* Global nav */}
        <div className="mb-4">
          {!collapsedDesktop ? (
            <p className="hib-sidebar-heading mb-1 px-3 text-[10px] uppercase tracking-[0.16em]">Navigate</p>
          ) : null}
          <nav className="space-y-1">
            {GLOBAL_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
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
        {!collapsedDesktop ? (
          <div className="mt-4 px-1">
            <ActiveRunsPanel />
          </div>
        ) : (
          <div className="mt-4 flex justify-center">
            <ActiveRunsPanel collapsed />
          </div>
        )}
      </div>

      {!collapsedDesktop ? (
        <div className="hib-sidebar-heading border-t border-white/5 px-4 py-3 text-[10px] uppercase tracking-[0.14em]">
          <Activity size={10} className="mr-1 inline" />
          <span>AI valuation</span>
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
