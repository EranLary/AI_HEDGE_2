import { DashboardError } from "@/components/dashboard-chrome";
import { getLivePerformance, loadTickerData } from "@/lib/dashboard-server";

import { DreamTeamClient } from "./dream-team-client";

export default async function DashboardDreamTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const search = (await searchParams) ?? {};
  const reportId = typeof search.report === "string" ? search.report : undefined;

  let resolved;
  try {
    resolved = await loadTickerData(ticker, reportId);
  } catch (err) {
    const upper = decodeURIComponent(String(ticker || "")).toUpperCase();
    return <DashboardError error={(err as Error)?.message || "Failed to load dashboard"} ticker={upper} />;
  }

  const { ticker: upper, data, reportsForTicker, resolvedReportId } = resolved;
  if (!data) {
    return <DashboardError error="No data" ticker={upper} />;
  }
  const live = await getLivePerformance(upper).catch(() => null);

  return (
    <DreamTeamClient
      ticker={upper}
      data={data}
      reportsForTicker={reportsForTicker}
      resolvedReportId={resolvedReportId}
      liveCurrentPrice={typeof live?.current_price === "number" ? live.current_price : null}
    />
  );
}
