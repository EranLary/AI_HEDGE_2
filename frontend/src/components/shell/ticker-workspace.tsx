"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  CandlestickChart,
  Download,
  FileText,
  ListChecks,
  Swords,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

import type { DashboardPayload } from "@/lib/dashboard-types";

type SectionItem = {
  slug: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
};

const DASHBOARD_SECTIONS: SectionItem[] = [
  { slug: "overview", label: "Overview", icon: FileText },
  { slug: "valuation", label: "Valuation", icon: BarChart3 },
  { slug: "scenarios", label: "Bull vs Bear", icon: Swords },
  { slug: "assumptions", label: "Assumptions", icon: ListChecks },
  { slug: "technical-analysis", label: "Technical Analysis", icon: CandlestickChart },
  { slug: "dream-team", label: "Dream Team", icon: Users },
];

type WorkspaceSummary = {
  companyName?: string;
};

type TickerWorkspaceProps = {
  ticker: string;
  collapsed?: boolean;
  onNavigate?: () => void;
};

export function TickerWorkspace({ ticker, collapsed = false, onNavigate }: TickerWorkspaceProps) {
  const pathname = usePathname() || "/";
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const upper = ticker.toUpperCase();
  const downloadHref = `/api/artifacts/${encodeURIComponent(upper)}/analysis-pdf`;

  useEffect(() => {
    if (!upper) return;
    let cancelled = false;
    fetch(`/api/dashboard/${encodeURIComponent(upper)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: DashboardPayload | null) => {
        if (cancelled || !j) return;
        setSummary({
          companyName: j.header?.company_name,
        });
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [upper]);

  if (collapsed) {
    return (
      <div className="space-y-1">
        <nav className="space-y-1">
          {DASHBOARD_SECTIONS.map((item) => {
            const href = `/dashboard/${encodeURIComponent(upper)}/${item.slug}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.slug}
                href={href}
                onClick={onNavigate}
                title={`${upper} - ${item.label}`}
                className={`hib-sidebar-item flex items-center justify-center rounded-lg px-2 py-2 text-sm ${
                  active ? "hib-sidebar-item-active" : ""
                }`}
              >
                <Icon size={14} />
              </Link>
            );
          })}
        </nav>
        <a
          href={downloadHref}
          onClick={onNavigate}
          title={`${upper} - Analysis PDF`}
          className="hib-sidebar-item flex items-center justify-center rounded-lg px-2 py-2 text-sm"
        >
          <Download size={14} />
        </a>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-emerald-400/25 bg-emerald-500/4 p-2">
      <header className="mb-2 rounded-lg border border-white/5 bg-black/25 px-3 py-2">
        <p className="hib-sidebar-heading text-[9px] uppercase tracking-[0.22em]">Workspace</p>
        <p className="mt-0.5 font-display text-base leading-tight text-zinc-100">{upper}</p>
        {summary?.companyName ? (
          <p className="truncate text-[10px] text-zinc-400">{summary.companyName}</p>
        ) : null}
      </header>
      <nav className="space-y-0.5">
        {DASHBOARD_SECTIONS.map((item) => {
          const href = `/dashboard/${encodeURIComponent(upper)}/${item.slug}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.slug}
              href={href}
              onClick={onNavigate}
              className={`hib-sidebar-item flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm ${
                active ? "hib-sidebar-item-active" : ""
              }`}
            >
              <Icon size={14} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-2">
        <a
          href={downloadHref}
          onClick={onNavigate}
          className="hib-sidebar-item flex items-center gap-3 rounded-lg border border-emerald-300/25 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-500/20"
        >
          <Download size={14} />
          <span className="truncate">Analysis PDF</span>
        </a>
      </div>
    </section>
  );
}
