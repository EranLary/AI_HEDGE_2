"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";

type TickerContextValue = {
  activeTicker: string | null;
  activeSection: string | null;
};

const TickerContext = createContext<TickerContextValue>({ activeTicker: null, activeSection: null });

const DASHBOARD_MATCH = /^\/dashboard\/([^/]+)(?:\/([^/]+))?/;

export function TickerProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";

  const value = useMemo<TickerContextValue>(() => {
    const match = pathname.match(DASHBOARD_MATCH);
    if (!match) return { activeTicker: null, activeSection: null };
    const ticker = decodeURIComponent(match[1] || "").toUpperCase();
    const section = match[2] ? decodeURIComponent(match[2]) : null;
    return { activeTicker: ticker || null, activeSection: section };
  }, [pathname]);

  return <TickerContext.Provider value={value}>{children}</TickerContext.Provider>;
}

export function useTickerContext(): TickerContextValue {
  return useContext(TickerContext);
}
