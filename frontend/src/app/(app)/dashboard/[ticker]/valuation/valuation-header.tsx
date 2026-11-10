"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useWorkspace } from "@/components/shell/workspace-context";

export type ValuationView = "methods" | "assumptions" | "jev";

export function ValuationHeader({ ticker, activeView }: { ticker: string; activeView: ValuationView }) {
  const search = useSearchParams();
  const { href } = useWorkspace();
  const reportId = search?.get("report") || "";

  const destination = (view: ValuationView) => {
    const path = view === "jev"
      ? `/dashboard/${encodeURIComponent(ticker)}/valuation/jev`
      : `/dashboard/${encodeURIComponent(ticker)}/valuation`;
    const params = new URLSearchParams();
    if (reportId) params.set("report", reportId);
    if (view === "assumptions") params.set("view", "assumptions");
    const suffix = params.size ? `?${params.toString()}` : "";
    return `${href(path)}${suffix}`;
  };

  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl text-[color:var(--text-primary)]">Valuation</h1>
        <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
          {ticker} — methods, assumptions &amp; forecast
        </p>
      </div>
      <nav
        aria-label="Valuation sections"
        className="inline-flex rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-1"
      >
        {([
          ["methods", "Methods"],
          ["assumptions", "Assumptions"],
          ["jev", "Jev"],
        ] as const).map(([view, label]) => (
          <Link
            key={view}
            href={destination(view)}
            aria-current={activeView === view ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              activeView === view
                ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                : "text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
