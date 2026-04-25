"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ActiveRunIndicator } from "@/components/active-run-indicator";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { TickerProvider } from "@/components/shell/ticker-context";
import { ToastProvider } from "@/components/shell/toast";
import { NewRunProvider } from "@/components/shell/new-run-context";
import { NewRunModal } from "@/components/shell/new-run-modal";

const COLLAPSE_KEY = "hib-sidebar-v1";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw === "1") setCollapsed(true);
    } catch {
      // ignore
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed, hydrated]);

  // Lock scroll when mobile drawer is open
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  return (
    <TickerProvider>
      <ToastProvider>
        <NewRunProvider>
        <div className="flex min-h-screen">
          {/* Desktop sidebar */}
          <div className="hidden md:block">
            <div className="sticky top-0 h-screen">
              <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
            </div>
          </div>

          {/* Mobile drawer */}
          {mobileOpen ? (
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
              <div
                className="absolute inset-0 bg-black/60"
                onClick={() => setMobileOpen(false)}
                aria-hidden
              />
              <div className="absolute left-0 top-0 h-full w-72 shadow-xl">
                <Sidebar
                  collapsed={false}
                  onToggle={() => undefined}
                  mobile
                  onMobileClose={() => setMobileOpen(false)}
                />
              </div>
            </div>
          ) : null}

          <div className="hib-content flex min-w-0 flex-1 flex-col">
            <Topbar onMobileMenu={() => setMobileOpen(true)} />
            <ActiveRunIndicator />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-white/10 bg-black/35 px-4 py-2 text-center text-[11px] text-zinc-400 sm:px-8">
              AI-generated. For informational purposes only. Not investment advice. No guarantee of accuracy or results.
            </footer>
          </div>
        </div>
        <NewRunModal />
        </NewRunProvider>
      </ToastProvider>
    </TickerProvider>
  );
}
