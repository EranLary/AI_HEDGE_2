import "server-only";

import { listDeletedReportRefs, listDeletedReportRefsForTicker } from "@/lib/reports-db";

export function siteRunIdFromPathLike(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, "/");
  const match = normalized.match(/\/_site_runs\/([^/]+)/i);
  return match?.[1] ? String(match[1]).trim() : null;
}

export type DeletedReportFilter = {
  isDeleted: (reportId: string, ticker?: string, runId?: string | null) => boolean;
};

function buildDeletedReportFilter(
  refs: Array<{ id: string; ticker: string; source_run_id: string | null }>,
): DeletedReportFilter {
  const ids = new Set<string>();
  const runKeys = new Set<string>();

  for (const ref of refs) {
    const id = String(ref.id || "").trim();
    const ticker = String(ref.ticker || "").trim().toUpperCase();
    const runId = String(ref.source_run_id || "").trim();
    if (id) ids.add(id);
    if (ticker && runId) runKeys.add(`${ticker}:${runId}`);
  }

  return {
    isDeleted(reportId: string, ticker?: string, runId?: string | null) {
      const id = String(reportId || "").trim();
      const tk = String(ticker || "").trim().toUpperCase();
      const run = String(runId || "").trim();
      return Boolean((id && ids.has(id)) || (tk && run && runKeys.has(`${tk}:${run}`)));
    },
  };
}

export async function getDeletedReportFilter(): Promise<DeletedReportFilter> {
  try {
    return buildDeletedReportFilter(await listDeletedReportRefs());
  } catch {
    return buildDeletedReportFilter([]);
  }
}

export async function getDeletedReportFilterForTicker(ticker: string): Promise<DeletedReportFilter> {
  try {
    return buildDeletedReportFilter(await listDeletedReportRefsForTicker(ticker));
  } catch {
    return buildDeletedReportFilter([]);
  }
}
