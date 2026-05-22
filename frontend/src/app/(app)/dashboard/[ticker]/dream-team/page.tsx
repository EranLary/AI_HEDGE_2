import { DashboardError } from "@/components/dashboard-chrome";
import { getLivePerformance, loadTickerData } from "@/lib/dashboard-server";

import { DreamTeamClient } from "./dream-team-client";

export default async function DashboardDreamTeamPage({
  params,
  searchParams: _searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;

  let resolved;
  try {
    // Dream Team blog page is always pinned to the latest report for this ticker.
    resolved = await loadTickerData(ticker);
  } catch (err) {
    const upper = decodeURIComponent(String(ticker || "")).toUpperCase();
    return <DashboardError error={(err as Error)?.message || "Failed to load dashboard"} ticker={upper} />;
  }

  const { ticker: upper, data, reportsForTicker, resolvedReportId } = resolved;
  if (!data) {
    return <DashboardError error="No data" ticker={upper} />;
  }
  const live = await getLivePerformance(upper).catch(() => null);
  const canUseChat = true;

  return (
    <DreamTeamClient
      ticker={upper}
      data={data}
      reportsForTicker={reportsForTicker}
      resolvedReportId={resolvedReportId}
      liveCurrentPrice={typeof live?.current_price === "number" ? live.current_price : null}
      canUseChat={canUseChat}
    />
  );
}
