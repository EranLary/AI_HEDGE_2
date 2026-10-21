import { DashboardError } from "@/components/dashboard-chrome";
import { JevForecastPanel } from "@/components/jev-forecast-panel";
import { loadTickerData } from "@/lib/dashboard-server";
import { getJevReportForecast } from "@/lib/jev-db";
import { parseWorkspace } from "@/lib/workspace";
import { ValuationHeader } from "../valuation-header";

export default async function DashboardValuationJevPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const search = (await searchParams) ?? {};
  const requestedReportId = typeof search.report === "string" ? search.report : undefined;
  const workspace = parseWorkspace(search.workspace);

  let resolved;
  try {
    resolved = await loadTickerData(ticker, requestedReportId, workspace);
  } catch (error) {
    const upper = decodeURIComponent(String(ticker || "")).toUpperCase();
    return <DashboardError error={(error as Error)?.message || "Failed to load dashboard"} ticker={upper} />;
  }

  const { ticker: upper, data, reportsForTicker, resolvedReportId } = resolved;
  if (!data || !resolvedReportId) return <DashboardError error="No report data" ticker={upper} />;

  const forecast = await getJevReportForecast(resolvedReportId, workspace).catch(() => null);

  return (
    <div>
      <ValuationHeader ticker={upper} activeView="jev" />
      <JevForecastPanel
        ticker={upper}
        reports={reportsForTicker}
        reportId={resolvedReportId}
        forecast={forecast}
      />
    </div>
  );
}
