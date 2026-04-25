"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { HedgeDashboard } from "@/components/hedge-dashboard";

export default function DashboardValuationPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const search = useSearchParams();
  const reportId = search?.get("report") || undefined;
  const upper = decodeURIComponent(ticker).toUpperCase();

  return (
    <HedgeDashboard
      tickerOverride={upper}
      reportIdOverride={reportId}
      forceMainTab="valuation"
      hideNavHeader
      hideMainTabBar
      hideDecisionFooter
    />
  );
}
