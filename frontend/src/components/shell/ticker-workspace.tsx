"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Download,
  FileText,
  Flag,
  ListChecks,
  Radar,
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
  { slug: "scenarios", label: "Bull vs Bear", icon: Radar },
  { slug: "assumptions", label: "Assumptions", icon: ListChecks },
  { slug: "flags", label: "Flags & Risks", icon: Flag },
  { slug: "dream-team", label: "Dream Team", icon: Users },
  { slug: "artifacts", label: "Artifacts", icon: Download },
];

function decisionLabel(pct?: number | null): { label: string; tone: "pos" | "neg" | "neu" } {
  const v = typeof pct === "number" && Number.isFinite(pct) ? pct : 0;
  if (v <= -10) return { label: "Strong Sell", tone: "neg" };
  if (v < -1) return { label: "Sell", tone: "neg" };
  if (v < 1) return { label: "Hold", tone: "neu" };
  if (v < 10) return { label: "Buy", tone: "pos" };
  return { label: "Strong Buy", tone: "pos" };
}

function fmtPrice(v: number | null | undefined, ticker: string): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const isIsraeli = String(ticker || "").toUpperCase().endsWith(".TA");
  const code = isIsraeli ? "ILS" : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${isIsraeli ? "₪" : "$"}${v.toFixed(2)}`;
  }
}

type WorkspaceSummary = {
  companyName?: string;
  currentPrice?: number | null;
  positionPct?: number | null;
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

  useEffect(() => {
    if (!upper) return;
    let cancelled = false;
    fetch(`/api/dashboard/${encodeURIComponent(upper)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: DashboardPayload | null) => {
        if (cancelled || !j) return;
        setSummary({
          companyName: j.header?.company_name,
          currentPrice: j.header?.current_price,
          positionPct: j.decision_card?.position_size_pct_of_notional,
        });
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [upper]);

  const decision = decisionLabel(summary?.positionPct);
  const decisionCls =
    decision.tone === "pos"
      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
      : decision.tone === "neg"
      ? "border-red-400/50 bg-red-500/15 text-red-100"
      : "border-white/20 bg-white/5 text-zinc-200";

  if (collapsed) {
    return (
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
              title={`${upper} — ${item.label}`}
              className={`hib-sidebar-item flex items-center justify-center rounded-lg px-2 py-2 text-sm ${
                active ? "hib-sidebar-item-active" : ""
              }`}
            >
              <Icon size={14} />
            </Link>
          );
        })}
      </nav>
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
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="hib-current-price text-sm font-semibold">{fmtPrice(summary?.currentPrice, upper)}</span>
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${decisionCls}`}>
            {decision.label}
          </span>
        </div>
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
    </section>
  );
}
