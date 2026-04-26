"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HedgeDashboard } from "@/components/hedge-dashboard";
import { TargetPriceChart } from "@/components/target-price-chart";
import type { DashboardPayload } from "@/lib/dashboard-types";

type View = "methods" | "assumptions";

export default function DashboardValuationPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const reportId = search?.get("report") || undefined;
  const upper = decodeURIComponent(ticker).toUpperCase();
  const [view, setView] = useState<View>("methods");
  const [payload, setPayload] = useState<DashboardPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const qs = reportId ? `?report=${encodeURIComponent(reportId)}` : "";
    fetch(`/api/dashboard/${encodeURIComponent(upper)}${qs}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((json) => {
        setPayload((json || null) as DashboardPayload | null);
      })
      .catch(() => {
        setPayload(null);
      });
    return () => controller.abort();
  }, [upper, reportId]);

  const handleReportChange = useCallback(
    (nextReportId: string) => {
      if (!nextReportId || nextReportId === reportId) return;
      const next = new URLSearchParams(search?.toString() || "");
      next.set("report", nextReportId);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [reportId, router, search],
  );

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-zinc-100">Valuation</h1>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            {upper} — methods &amp; assumptions
          </p>
        </div>
        <nav className="inline-flex rounded-xl border border-white/10 bg-zinc-950/70 p-1">
          <button
            type="button"
            onClick={() => setView("methods")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              view === "methods" ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            Methods
          </button>
          <button
            type="button"
            onClick={() => setView("assumptions")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              view === "assumptions" ? "bg-emerald-500/20 text-emerald-100" : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            Assumptions
          </button>
        </nav>
      </header>

      <HedgeDashboard
        tickerOverride={upper}
        reportIdOverride={reportId}
        forceMainTab={view === "methods" ? "valuation" : "values"}
        hideNavHeader
        hideMainTabBar
        hideDecisionFooter
        onReportChange={handleReportChange}
        postHeaderSlot={<TargetPriceChart data={payload} />}
      />
    </div>
  );
}
