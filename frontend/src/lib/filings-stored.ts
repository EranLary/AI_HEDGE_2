import type { DashboardPayload } from "@/lib/dashboard-types";
import { getDeletedReportFilterForTicker, siteRunIdFromPathLike } from "@/lib/deleted-reports";
import { fetchLatestReport } from "@/lib/reports-db";
import { listDashboardReports, readJson } from "@/lib/server-outputs";

export type StoredFiling = {
  available: boolean;
  source: string;
  form_type: string;
  date: string;
  source_url: string;
  text: string;
};

export type StoredFilingsStatus = {
  ticker: string;
  filings: {
    annual: StoredFiling;
    quarterly: StoredFiling;
  };
  context_error?: string;
};

function emptyFiling(): StoredFiling {
  return { available: false, source: "", form_type: "", date: "", source_url: "", text: "" };
}

function normalizeRow(value: unknown): StoredFiling {
  const row = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  const sourceUrl = String(row.source_url || "").trim();
  return {
    available: Boolean(row.available) && sourceUrl.length > 0,
    source: String(row.source || ""),
    form_type: String(row.form_type || ""),
    date: String(row.date || ""),
    source_url: sourceUrl,
    text: "",
  };
}

function extractFromDashboard(payload: DashboardPayload | null | undefined): StoredFilingsStatus["filings"] {
  return {
    annual: normalizeRow(payload?.filings?.annual),
    quarterly: normalizeRow(payload?.filings?.quarterly),
  };
}

async function readLatestDashboardPayload(ticker: string): Promise<DashboardPayload | null> {
  const tk = String(ticker || "").trim().toUpperCase();
  if (!tk) return null;

  try {
    const dbRow = await fetchLatestReport(tk);
    const dashboard = dbRow?.dashboard as DashboardPayload | null | undefined;
    if (dashboard && typeof dashboard === "object") {
      return dashboard;
    }
  } catch {
    // Fall through to outputs scan.
  }

  const deletedFilter = await getDeletedReportFilterForTicker(tk);
  for (const entry of listDashboardReports()) {
    if (String(entry.ticker || "").toUpperCase() !== tk) continue;
    if (deletedFilter.isDeleted(entry.report_id, tk, siteRunIdFromPathLike(entry.path))) continue;
    const payload = readJson<DashboardPayload>(entry.path);
    if (payload) return payload;
  }
  return null;
}

export async function getStoredTickerFilingsStatus(ticker: string): Promise<StoredFilingsStatus> {
  const tk = String(ticker || "").trim().toUpperCase();
  const payload = await readLatestDashboardPayload(tk);
  if (!payload) {
    return {
      ticker: tk,
      filings: {
        annual: emptyFiling(),
        quarterly: emptyFiling(),
      },
      context_error: "No stored dashboard payload found for ticker.",
    };
  }
  return {
    ticker: tk,
    filings: extractFromDashboard(payload),
    context_error: "",
  };
}

