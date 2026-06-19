import { DashboardError } from "@/components/dashboard-chrome";
import { getLivePerformance, getLiveYahooqueryInfo, loadTickerData } from "@/lib/dashboard-server";

import { InfoClient } from "./info-client";

export default async function DashboardInfoPage({
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

  const { ticker: upper, reportsForTicker, resolvedReportId } = resolved;
  const [info, performance] = await Promise.all([
    getLiveYahooqueryInfo(upper),
    getLivePerformance(upper).catch(() => null),
  ]);

  return (
    <InfoClient
      ticker={upper}
      info={info}
      returnsPct={performance?.returns_pct || {}}
      liveCurrentPrice={typeof performance?.current_price === "number" ? performance.current_price : null}
      reportsForTicker={reportsForTicker}
      resolvedReportId={resolvedReportId}
    />
  );
}

