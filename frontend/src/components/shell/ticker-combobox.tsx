"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search, X } from "lucide-react";
import type { ReportListItem } from "@/lib/dashboard-types";
import { useTickerContext } from "@/components/shell/ticker-context";

type ComboboxProps = {
  collapsed?: boolean;
  onCollapsedClick?: () => void;
};

export function TickerCombobox({ collapsed = false, onCollapsedClick }: ComboboxProps) {
  const router = useRouter();
  const { activeTicker } = useTickerContext();
  const [tickers, setTickers] = useState<string[]>([]);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [tickersRes, reportsRes] = await Promise.all([
          fetch("/api/tickers", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ tickers: [] })),
          fetch("/api/reports", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ reports: [] })),
        ]);
        if (cancelled) return;
        const fromReports: string[] = Array.isArray(reportsRes?.reports)
          ? (reportsRes.reports as ReportListItem[]).map((r) => String(r.ticker || "").toUpperCase()).filter(Boolean)
          : [];
        const fromTickers: string[] = Array.isArray(tickersRes?.tickers)
          ? (tickersRes.tickers as string[]).map((t) => String(t || "").toUpperCase()).filter(Boolean)
          : [];
        const merged = Array.from(new Set([...fromReports, ...fromTickers]));
        setTickers(merged);
        setReports(Array.isArray(reportsRes?.reports) ? (reportsRes.reports as ReportListItem[]) : []);
      } catch {
        if (!cancelled) {
          setTickers([]);
          setReports([]);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const recentByTicker = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of reports) {
      const t = String(r.ticker || "").toUpperCase();
      const ms = Date.parse(String(r.generated_at || r.updated_at || ""));
      if (!t || !Number.isFinite(ms)) continue;
      const existing = map.get(t);
      if (existing == null || ms > existing) map.set(t, ms);
    }
    return map;
  }, [reports]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const sorted = [...tickers].sort((a, b) => {
      const aMs = recentByTicker.get(a) ?? 0;
      const bMs = recentByTicker.get(b) ?? 0;
      if (aMs !== bMs) return bMs - aMs;
      return a.localeCompare(b);
    });
    if (!q) return sorted.slice(0, 20);
    return sorted.filter((t) => t.includes(q)).slice(0, 20);
  }, [tickers, query, recentByTicker]);

  function pick(ticker: string) {
    const t = String(ticker || "").trim().toUpperCase();
    if (!t) return;
    setOpen(false);
    setQuery("");
    router.push(`/dashboard/${encodeURIComponent(t)}/summary`);
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onCollapsedClick}
        aria-label="Open ticker picker"
        className="hib-sidebar-item flex h-10 w-10 items-center justify-center rounded-lg text-xs font-semibold"
      >
        {activeTicker ? activeTicker.slice(0, 3) : <Search size={14} />}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hib-sidebar-item flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm"
      >
        <span className="flex items-center gap-2 truncate">
          <Search size={14} />
          <span className="truncate">{activeTicker || "Pick a ticker"}</span>
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="hib-auth-menu absolute left-0 right-0 top-full z-50 mt-1 rounded-xl p-2 shadow-xl">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              placeholder="Type ticker..."
              className="w-full rounded-md border border-white/10 bg-black/30 py-1.5 pl-7 pr-7 text-base uppercase tracking-[0.06em] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-400/50 sm:text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered[0]) {
                  e.preventDefault();
                  pick(filtered[0]);
                }
              }}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                aria-label="Clear"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
          <div className="mt-2 max-h-[260px] overflow-auto">
            {filtered.length ? (
              filtered.map((t) => {
                const ms = recentByTicker.get(t);
                const when = ms ? new Date(ms).toLocaleDateString() : null;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => pick(t)}
                    className="hib-auth-menu-item flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    <span className="font-semibold">{t}</span>
                    {when ? <span className="text-[10px] text-zinc-500">{when}</span> : null}
                  </button>
                );
              })
            ) : (
              <p className="px-2 py-3 text-xs text-zinc-500">No tickers match.</p>
            )}
          </div>
          {query && !filtered.includes(query.trim()) ? (
            <button
              type="button"
              onClick={() => pick(query)}
              className="hib-auth-menu-item mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs"
            >
              Open <span className="font-semibold">{query.trim()}</span> anyway
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
