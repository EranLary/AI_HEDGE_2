import { DashboardError } from "@/components/dashboard-chrome";
import { loadTickerData } from "@/lib/dashboard-server";
import { fetchResearchAudit } from "@/lib/research-audit-db";
import { parseWorkspace } from "@/lib/workspace";

import { AuditClient } from "./audit-client";

export default async function DashboardAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const search = await searchParams;
  const upper = decodeURIComponent(ticker).toUpperCase();
  const reportId = typeof search.report === "string" ? search.report : undefined;
  const workspace = parseWorkspace(search.workspace);
  let resolved: Awaited<ReturnType<typeof loadTickerData>>;
  let audit: Awaited<ReturnType<typeof fetchResearchAudit>>;
  try {
    resolved = await loadTickerData(upper, reportId, workspace);
    audit = resolved.resolvedReportId ? await fetchResearchAudit(resolved.resolvedReportId) : null;
  } catch (error) {
    return <DashboardError error={(error as Error)?.message || "Failed to load research audit"} ticker={upper} />;
  }
  return (
    <AuditClient
      ticker={upper}
      audit={audit}
      reports={resolved.reportsForTicker}
      currentReportId={resolved.resolvedReportId}
    />
  );
}
