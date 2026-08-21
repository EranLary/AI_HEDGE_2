import "server-only";

import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { isDbEnabled } from "@/lib/db";
import { getDeletedReportFilter, siteRunIdFromPathLike } from "@/lib/deleted-reports";
import { listAllDashboardsForHitRate } from "@/lib/reports-db";
import { listDashboardReports, readJson } from "@/lib/server-outputs";
import { computeTickerSummaryAggregation, type SummarySourceReport } from "@/lib/ticker-summary-aggregate";
import { parseApiWorkspace, type Workspace } from "@/lib/workspace";

const CACHE_VERSION = 5;

const SCREENER_FILES = {
  sp500: {
    cacheFile: "sp500_profiles.json",
    seedFile: "sp500_screener_scores_seed.json",
  },
  nasdaq100: {
    cacheFile: "nasdaq100_profiles.json",
    seedFile: "nasdaq100_screener_scores_seed.json",
  },
  ta125: {
    cacheFile: "ta125_profiles.json",
    seedFile: "ta125_screener_scores_seed.json",
  },
} as const;

export type ScreenerUniverse = keyof typeof SCREENER_FILES;

type TargetSummary = {
  target: number | null;
  samples: number;
};

type TargetData = {
  aliasMap: Map<string, TargetSummary>;
  exactMap: Map<string, TargetSummary>;
  exactReportTickers: Set<string>;
};

function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

function runScreener(universe: ScreenerUniverse, refresh: boolean, targetData: TargetData): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const root = repoRoot();
    const scriptPath = path.resolve(root, "scripts", "screener_sp500_profiles.py");
    const pythonExe = process.env.PYTHON_EXECUTABLE || "python";
    const args = [scriptPath, "--universe", universe, "--cache-minutes", "720", "--workers", "6"];
    if (refresh) args.push("--refresh");

    const child = spawn(pythonExe, args, {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: path.resolve(root, "src"),
        SCREENER_PLATFORM_TICKERS:
          universe === "ta125" ? JSON.stringify(Array.from(targetData.exactReportTickers)) : undefined,
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (payload: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(payload);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ status: "error", rows: [], error: "Screener process timed out." });
    }, 90_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      finish({ status: "error", rows: [], error: err.message || "Screener process failed." });
    });
    child.on("close", () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        if (parsed.status !== "success" && stderr.trim() && !parsed.error) {
          parsed.error = stderr.trim();
        }
        finish(parsed);
      } catch {
        finish({ status: "error", rows: [], error: stderr.trim() || "Screener output was not valid JSON." });
      }
    });
  });
}

async function readLastGoodCache(universe: ScreenerUniverse): Promise<Record<string, unknown> | null> {
  try {
    const cachePath = path.resolve(repoRoot(), "outputs", "_screeners", SCREENER_FILES[universe].cacheFile);
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as Record<string, unknown>;
    const rows = parsed.rows;
    if (parsed.status === "success" && parsed.cache_version === CACHE_VERSION && Array.isArray(rows) && rows.length) {
      return { ...parsed, cache_hit: true, stale_cache: true };
    }
  } catch {
    return null;
  }
  return null;
}

async function readBootstrapSeed(universe: ScreenerUniverse): Promise<Record<string, unknown> | null> {
  try {
    const seedPath = path.resolve(repoRoot(), "src", "ai_hedge", "static_data", SCREENER_FILES[universe].seedFile);
    const parsed = JSON.parse(await fs.readFile(seedPath, "utf8")) as Record<string, unknown>;
    const rows = parsed.rows;
    if (parsed.status === "success" && parsed.cache_version === CACHE_VERSION && Array.isArray(rows) && rows.length) {
      return { ...parsed, cache_hit: false, bootstrap_seed: true };
    }
  } catch {
    return null;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function tickerKeys(value: unknown): string[] {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return [];
  const withoutTa = raw.endsWith(".TA") ? raw.slice(0, -3) : raw;
  const variants = [
    withoutTa,
    withoutTa.replace(/-/g, "."),
    withoutTa.replace(/\./g, "-"),
    raw,
    raw.replace(/-/g, "."),
    raw.replace(/\./g, "-"),
  ];
  if (!raw.endsWith(".TA")) {
    variants.push(`${withoutTa}.TA`);
  }
  return Array.from(new Set(variants.filter(Boolean)));
}

function sameTickerKeys(value: unknown): string[] {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return [];
  return Array.from(new Set([raw, raw.replace(/-/g, "."), raw.replace(/\./g, "-")].filter(Boolean)));
}

function taPreferredTicker(value: unknown, exactReportTickers: Set<string>): string | null {
  const base = String(value || "").trim().toUpperCase().replace(/\.TA$/, "");
  if (!base) return null;
  if (exactReportTickers.has(base)) return base;
  const taTicker = `${base}.TA`;
  if (exactReportTickers.has(taTicker)) return taTicker;
  return null;
}

function taExpectedQueryTicker(value: unknown, exactReportTickers: Set<string>): string | null {
  const base = String(value || "").trim().toUpperCase().replace(/\.TA$/, "");
  if (!base) return null;
  return taPreferredTicker(base, exactReportTickers) || `${base}.TA`;
}

function targetKeys(row: Record<string, unknown>, universe: ScreenerUniverse): string[] {
  if (universe === "ta125") {
    return sameTickerKeys(row.query_ticker || row.ticker);
  }
  const values = [row.ticker, row.query_ticker];
  const keys: string[] = [];
  for (const value of values) {
    for (const key of sameTickerKeys(value)) {
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function putAliasTarget(map: Map<string, TargetSummary>, ticker: unknown, summary: TargetSummary) {
  for (const key of tickerKeys(ticker)) {
    map.set(key, summary);
  }
}

function putExactTarget(map: Map<string, TargetSummary>, ticker: unknown, summary: TargetSummary) {
  for (const key of sameTickerKeys(ticker)) {
    map.set(key, summary);
  }
}

async function buildTargetData(workspace: Workspace): Promise<TargetData> {
  const byTicker = new Map<string, SummarySourceReport[]>();
  const merged = new Map<string, SummarySourceReport>();

  try {
    const dbRows = await listAllDashboardsForHitRate(workspace);
    for (const row of dbRows) {
      const ticker = String(row.ticker || "").trim().toUpperCase();
      const payload = row.dashboard as DashboardPayload;
      if (!ticker || !payload) continue;
      const generatedAt = new Date(row.generated_at).toISOString();
      const key = row.source_run_id ? `run:${ticker}:${row.source_run_id}` : `db:${ticker}:${generatedAt}`;
      merged.set(key, { ticker, generatedAt, payload });
    }
    if (merged.size > 0 && isDbEnabled()) {
      for (const report of merged.values()) {
        const bucket = byTicker.get(report.ticker) || [];
        bucket.push(report);
        byTicker.set(report.ticker, bucket);
      }
    }
  } catch (err) {
    console.warn("[screeners] DB target read failed:", err);
  }

  if (workspace === "analysis" && byTicker.size === 0) {
    const deletedFilter = await getDeletedReportFilter(workspace);
    for (const entry of listDashboardReports()) {
      const ticker = String(entry.ticker || "").trim().toUpperCase();
      if (!ticker) continue;
      const runId = siteRunIdFromPathLike(entry.path);
      if (deletedFilter.isDeleted(entry.report_id, ticker, runId)) continue;
      const payload = readJson<DashboardPayload>(entry.path);
      if (!payload) continue;
      const generatedAt =
        typeof payload.generated_at === "string" && payload.generated_at.trim()
          ? payload.generated_at
          : new Date(entry.mtimeMs).toISOString();
      const report = { ticker, generatedAt, payload };
      const bucket = byTicker.get(ticker) || [];
      bucket.push(report);
      byTicker.set(ticker, bucket);
    }
  }

  const aliasMap = new Map<string, TargetSummary>();
  const exactMap = new Map<string, TargetSummary>();
  const exactReportTickers = new Set<string>();
  for (const [ticker, reports] of byTicker.entries()) {
    exactReportTickers.add(ticker);
    const aggregation = computeTickerSummaryAggregation(reports, "all");
    const target = numberOrNull(aggregation.overview.mean_target_price);
    const samples = Number(aggregation.overview.target_samples || 0);
    const summary = { target, samples };
    putAliasTarget(aliasMap, ticker, summary);
    putExactTarget(exactMap, ticker, summary);
  }
  return { aliasMap, exactMap, exactReportTickers };
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

function emptyTargetData(): TargetData {
  return { aliasMap: new Map<string, TargetSummary>(), exactMap: new Map<string, TargetSummary>(), exactReportTickers: new Set<string>() };
}

function needsTa125PreferenceRefresh(payload: Record<string, unknown>, targetData: TargetData): boolean {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return false;
  return rows.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const row = raw as Record<string, unknown>;
    const preferred = taExpectedQueryTicker(row.ticker, targetData.exactReportTickers);
    if (!preferred) return false;
    return String(row.query_ticker || "").trim().toUpperCase() !== preferred;
  });
}

async function enrichWithTargets(payload: Record<string, unknown>, universe: ScreenerUniverse, targetData: TargetData): Promise<Record<string, unknown>> {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return payload;
  const targetMap = targetData.exactMap;
  let targetsMatched = 0;
  const enrichedRows = rows.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const row = raw as Record<string, unknown>;
    const targetSummary = targetKeys(row, universe)
      .map((key) => targetMap.get(key))
      .find(Boolean);
    const price = numberOrNull(row.current_price);
    const target = targetSummary?.target ?? null;
    const change = price !== null && price > 0 && target !== null ? ((target - price) / price) * 100 : null;
    if (target !== null) targetsMatched += 1;
    return {
      ...row,
      target_price: target,
      target_samples: targetSummary?.samples || 0,
      target_change_pct: change,
    };
  });
  return {
    ...payload,
    target_source: "platform_summary_all_reports",
    target_matches: targetsMatched,
    rows: enrichedRows,
  };
}

export async function handleScreenerRequest(req: Request, universe: ScreenerUniverse) {
  const url = new URL(req.url);
  const workspace = parseApiWorkspace(url.searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  if (workspace === "nasdaq100" && universe !== "nasdaq100") {
    return NextResponse.json({ error: "Screener not available in this workspace." }, { status: 404 });
  }
  const refresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
  const targetData = await withTimeout(buildTargetData(workspace), 10_000, emptyTargetData());
  let forceRefresh = false;
  if (!refresh) {
    const cached = (await readLastGoodCache(universe)) || (await readBootstrapSeed(universe));
    if (cached) {
      forceRefresh = universe === "ta125" && needsTa125PreferenceRefresh(cached, targetData);
      if (!forceRefresh) {
        return NextResponse.json(await enrichWithTargets(cached, universe, targetData), { status: 200 });
      }
    }
  }
  const payload = await runScreener(universe, refresh || forceRefresh, targetData);
  if (payload.status !== "success") {
    const fallback = (await readLastGoodCache(universe)) || (await readBootstrapSeed(universe));
    if (fallback) {
      return NextResponse.json(await enrichWithTargets(fallback, universe, targetData), { status: 200 });
    }
  }
  const status = payload.status === "success" ? 200 : 502;
  const responsePayload = payload.status === "success" ? await enrichWithTargets(payload, universe, targetData) : payload;
  return NextResponse.json(responsePayload, { status });
}
