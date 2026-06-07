import { DashboardError } from "@/components/dashboard-chrome";
import { loadTickerData } from "@/lib/dashboard-server";

import { SecQaClient } from "./sec-qa-client";

export default async function DashboardSecQaPage({
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

  return (
    <SecQaClient
      ticker={upper}
      data={data}
      reportsForTicker={reportsForTicker}
      resolvedReportId={resolvedReportId}
    />
  );
}
