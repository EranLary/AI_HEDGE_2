import { DashboardError } from "@/components/dashboard-chrome";
import { loadTickerData } from "@/lib/dashboard-server";
import { parseWorkspace } from "@/lib/workspace";

import { WallStClient } from "./wall-st-client";

export default async function DashboardWallStPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const search = (await searchParams) ?? {};
  const reportId = typeof search.report === "string" ? search.report : undefined;
  const workspace = parseWorkspace(search.workspace);

  let resolved;
  try {
    resolved = await loadTickerData(ticker, reportId, workspace);
  } catch (err) {
    const upper = decodeURIComponent(String(ticker || "")).toUpperCase();
    return <DashboardError error={(err as Error)?.message || "Failed to load dashboard"} ticker={upper} />;
  }

  const { ticker: upper, data, reportsForTicker, resolvedReportId } = resolved;
  if (!data) {
    return <DashboardError error="No data" ticker={upper} />;
  }

  return (
    <WallStClient
      ticker={upper}
      data={data}
      reportsForTicker={reportsForTicker}
      resolvedReportId={resolvedReportId}
    />
  );
}
