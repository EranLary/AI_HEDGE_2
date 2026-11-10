"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { HedgeDashboard } from "@/components/hedge-dashboard";
import { useWorkspace } from "@/components/shell/workspace-context";
import { TargetPriceChart } from "@/components/target-price-chart";
import { ValuationShareCount } from "@/components/valuation-share-count";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { ValuationHeader } from "./valuation-header";

type View = "methods" | "assumptions";

export default function DashboardValuationPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const { workspace, api } = useWorkspace();
  const router = useRouter();
  const search = useSearchParams();
  const reportId = search?.get("report") || undefined;
  const upper = decodeURIComponent(ticker).toUpperCase();
  const view: View = search?.get("view") === "assumptions" ? "assumptions" : "methods";
  const [payload, setPayload] = useState<DashboardPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const qs = reportId ? `?report=${encodeURIComponent(reportId)}` : "";
    fetch(api(`/api/dashboard/${encodeURIComponent(upper)}${qs}`), {
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
  }, [api, upper, reportId, workspace]);

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
      <ValuationHeader ticker={upper} activeView={view} />

      <HedgeDashboard
        tickerOverride={upper}
        reportIdOverride={reportId}
        forceMainTab={view === "methods" ? "valuation" : "values"}
        hideNavHeader
        hideMainTabBar
        hideScoreFooter
        onReportChange={handleReportChange}
        postHeaderSlot={(
          <>
            {payload ? (
              <div className="mb-3 flex justify-end">
                <div className="w-full sm:w-[22rem]">
                  <ValuationShareCount data={payload} />
                </div>
              </div>
            ) : null}
            <TargetPriceChart data={payload} />
          </>
        )}
      />
    </div>
  );
}
