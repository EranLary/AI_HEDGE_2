import "server-only";

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { unstable_cache } from "next/cache";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import {
  buildFallbackFromArtifacts,
  normalizePayload,
} from "@/lib/dashboard-normalize";
import {
  getDeletedReportFilter,
  getDeletedReportFilterForTicker,
  siteRunIdFromPathLike,
} from "@/lib/deleted-reports";
import {
  fetchLatestReport,
  fetchReportById,
  listAllReports,
} from "@/lib/reports-db";
import {
  findLatestByFileName,
  listDashboardReports,
  readJson,
  resolveDashboardReportPath,
} from "@/lib/server-outputs";
import { repoRoot } from "@/lib/site-runner";

export type LivePerformance = {
  ticker: string;
  current_price?: number | null;
  returns_pct: {
    "1D"?: number | null;
    "1W"?: number | null;
    "1M"?: number | null;
    "3M"?: number | null;
    "6M"?: number | null;
    "1Y"?: number | null;
    "3Y"?: number | null;
    "5Y"?: number | null;
  };
};

async function loadReportsList(): Promise<ReportListItem[]> {
  const merged = new Map<string, ReportListItem>();
  const deletedFilter = await getDeletedReportFilter();

  try {
    const dbRows = await listAllReports();
    for (const r of dbRows) {
      const row: ReportListItem = {
        report_id: r.id,
        ticker: r.ticker,
        generated_at: new Date(r.generated_at).toISOString(),
        report_file: r.source_run_id || r.id,
        updated_at: new Date(r.generated_at).toISOString(),
      };
      const runId = String(r.source_run_id || "").trim();
      const key = runId ? `run:${String(r.ticker || "").toUpperCase()}:${runId}` : `db:${r.id}`;
      merged.set(key, row);
    }
  } catch (err) {
    console.warn("[reports] DB read failed:", err);
  }

  const reports = listDashboardReports();
  for (const report of reports) {
    const payload = readJson<DashboardPayload>(report.path);
    const generatedAt = String(payload?.generated_at || new Date(report.mtimeMs).toISOString());
    const row: ReportListItem = {
      report_id: report.report_id,
      ticker: report.ticker,
      generated_at: generatedAt,
      report_file: report.path,
      updated_at: new Date(report.mtimeMs).toISOString(),
    };
    const runId = siteRunIdFromPathLike(report.path);
    const key = runId ? `run:${report.ticker}:${runId}` : `file:${report.path}`;
    if (deletedFilter.isDeleted(report.report_id, report.ticker, runId)) continue;
    if (merged.has(key)) continue;
    merged.set(key, row);
  }

  return Array.from(merged.values()).sort((a, b) => {
    const aMs = Date.parse(String(a.generated_at || a.updated_at || ""));
    const bMs = Date.parse(String(b.generated_at || b.updated_at || ""));
    const safeA = Number.isFinite(aMs) ? aMs : 0;
    const safeB = Number.isFinite(bMs) ? bMs : 0;
    return safeB - safeA;
  });
}

export const getReportsList = unstable_cache(
  loadReportsList,
  ["reports-list-v1"],
  { revalidate: 60, tags: ["reports"] },
);

async function loadDashboardPayload(
  ticker: string,
  reportId: string,
): Promise<DashboardPayload> {
  const tk = ticker.toUpperCase();
  const deletedFilter = await getDeletedReportFilterForTicker(tk);
  if (reportId && deletedFilter.isDeleted(reportId, tk)) {
    return normalizePayload(tk, { ticker: tk } as DashboardPayload, {
      reportId,
    });
  }

  try {
    const dbRow = reportId
      ? await fetchReportById(reportId)
      : await fetchLatestReport(tk);
    if (dbRow && dbRow.dashboard) {
      const generated = new Date(dbRow.generated_at).toISOString();
      return normalizePayload(tk, dbRow.dashboard as DashboardPayload, {
        reportId: dbRow.id,
        reportFile: undefined,
        reportMtime: generated,
      });
    }
  } catch (err) {
    console.warn(`[dashboard] DB read failed for ${tk}:`, err);
  }

  let dashboardPath = "";
  let dashboardMtime = 0;

  if (reportId) {
    const resolved = resolveDashboardReportPath(reportId);
    if (resolved) {
      const runId = siteRunIdFromPathLike(resolved);
      if (deletedFilter.isDeleted(reportId, tk, runId)) {
        return normalizePayload(tk, { ticker: tk } as DashboardPayload, {
          reportId,
        });
      }
      const base = resolved.split(/[\\/]/).pop() || "";
      if (base.toUpperCase().startsWith(`${tk}_DASHBOARD.JSON`)) {
        dashboardPath = resolved;
        try {
          dashboardMtime = fs.statSync(resolved).mtimeMs;
        } catch {
          dashboardMtime = 0;
        }
      }
    }
  }

  if (!dashboardPath) {
    const dashboardName = `${tk}_dashboard.json`;
    const latest = findLatestByFileName(dashboardName);
    if (latest && !deletedFilter.isDeleted("", tk, siteRunIdFromPathLike(latest.path))) {
      dashboardPath = latest.path;
      dashboardMtime = latest.mtimeMs;
    }
  }

  if (!dashboardPath) {
    return normalizePayload(tk, buildFallbackFromArtifacts(tk), {
      reportId: reportId || undefined,
    });
  }

  const parsed = readJson<DashboardPayload>(dashboardPath);
  if (!parsed) {
    return normalizePayload(tk, buildFallbackFromArtifacts(tk), {
      reportId: reportId || undefined,
      reportFile: dashboardPath,
      reportMtime: dashboardMtime ? new Date(dashboardMtime).toISOString() : undefined,
    });
  }

  return normalizePayload(tk, parsed, {
    reportId: reportId || undefined,
    reportFile: dashboardPath,
    reportMtime: dashboardMtime ? new Date(dashboardMtime).toISOString() : undefined,
  });
}

export const getDashboardPayload = unstable_cache(
  (ticker: string, reportId: string) => loadDashboardPayload(ticker, reportId),
  ["dashboard-payload-v2"],
  { revalidate: 300, tags: ["reports"] },
);

function runLiveReturnsScript(ticker: string): Promise<LivePerformance> {
  return new Promise((resolve, reject) => {
    const root = repoRoot();
    const scriptPath = path.resolve(root, "scripts", "live_returns.py");
    const pythonExe = process.env.PYTHON_EXECUTABLE || "python";

    const child = spawn(pythonExe, [scriptPath, "--ticker", ticker], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: path.resolve(root, "src"),
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `live_returns.py exited with ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as LivePerformance;
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function runLivePricesBatchScript(tickers: string[]): Promise<Record<string, number | null>> {
  return new Promise((resolve, reject) => {
    const clean = Array.from(new Set(tickers.map((t) => String(t || "").trim().toUpperCase()).filter(Boolean)));
    if (!clean.length) {
      resolve({});
      return;
    }

    const root = repoRoot();
    const scriptPath = path.resolve(root, "scripts", "live_prices_batch.py");
    const pythonExe = process.env.PYTHON_EXECUTABLE || "python";
    const workers = String(process.env.HIT_RATE_PRICE_WORKERS || "12");

    const child = spawn(pythonExe, [scriptPath, "--tickers", clean.join(","), "--workers", workers], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: path.resolve(root, "src"),
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `live_prices_batch.py exited with ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { prices?: Record<string, unknown> };
        const out: Record<string, number | null> = {};
        for (const ticker of clean) {
          const raw = parsed?.prices?.[ticker];
          const n = Number(raw);
          out[ticker] = Number.isFinite(n) ? n : null;
        }
        resolve(out);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export const getLivePerformance = unstable_cache(
  async (ticker: string): Promise<LivePerformance> => {
    const tk = ticker.toUpperCase();
    try {
      const result = await runLiveReturnsScript(tk);
      return {
        ticker: tk,
        current_price:
          typeof result?.current_price === "number" && Number.isFinite(result.current_price)
            ? Number(result.current_price)
            : null,
        returns_pct: result?.returns_pct || {},
      };
    } catch {
      return { ticker: tk, current_price: null, returns_pct: {} };
    }
  },
  ["live-performance-v1"],
  { revalidate: 120 },
);

export async function getLiveCurrentPricesBatch(tickers: string[]): Promise<Record<string, number | null>> {
  try {
    return await runLivePricesBatchScript(tickers);
  } catch {
    const unique = Array.from(new Set(tickers.map((t) => String(t || "").trim().toUpperCase()).filter(Boolean)));
    const pairs = await Promise.all(
      unique.map(async (ticker) => {
        const result = await getLivePerformance(ticker).catch(() => null);
        const price =
          typeof result?.current_price === "number" && Number.isFinite(result.current_price)
            ? Number(result.current_price)
            : null;
        return [ticker, price] as const;
      }),
    );
    return Object.fromEntries(pairs);
  }
}

export type ResolvedTickerData = {
  ticker: string;
  reports: ReportListItem[];
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
  data: DashboardPayload;
};

function reportTimestamp(report: ReportListItem): number {
  const ms = Date.parse(String(report.generated_at || report.updated_at || ""));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Single entry point used by every ticker subroute. Loads the reports list and
 * dashboard payload in parallel, resolves which report is selected, and returns
 * everything a page needs. Both calls are cached, so navigating between
 * subroutes is a cache hit (no DB / no FS reads).
 */
export async function loadTickerData(
  rawTicker: string,
  rawReportId?: string,
): Promise<ResolvedTickerData> {
  const ticker = decodeURIComponent(String(rawTicker || "")).toUpperCase();
  const requestedReportId = String(rawReportId || "").trim();

  const [reports, payloadByLatest] = await Promise.all([
    getReportsList(),
    requestedReportId ? Promise.resolve(null) : getDashboardPayload(ticker, ""),
  ]);

  const reportsForTicker = reports
    .filter((r) => String(r.ticker || "").toUpperCase() === ticker)
    .sort((a, b) => reportTimestamp(b) - reportTimestamp(a));

  const explicit = requestedReportId
    ? reportsForTicker.find((r) => r.report_id === requestedReportId)
    : null;
  const resolvedReportId = explicit ? explicit.report_id : reportsForTicker[0]?.report_id || "";

  let data: DashboardPayload;
  if (requestedReportId) {
    data = await getDashboardPayload(ticker, requestedReportId);
  } else if (payloadByLatest) {
    data = payloadByLatest;
  } else {
    data = await getDashboardPayload(ticker, "");
  }

  return { ticker, reports, reportsForTicker, resolvedReportId, data };
}
