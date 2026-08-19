import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  allDiscoveryLenses,
  prepareDiscoveryUniverse,
  scoreDiscoveryCandidates,
  type DiscoveryLensSelection,
  type DiscoverySourceReport,
} from "../src/lib/discovery-engine";
import { isExcludedTicker } from "../src/lib/excluded-tickers";
import {
  acquirePortfolioRefreshLock,
  deletePortfolioTrack,
  insertPortfolioSnapshot,
  listPortfolioReportInputs,
  loadMarketPrices,
  loadPortfolioSnapshots,
  releasePortfolioRefreshLock,
  upsertMarketPrices,
  upsertPortfolioNav,
  type PortfolioReportInput,
} from "../src/lib/portfolio-db";
import {
  buildHoldingsForSnapshot,
  computePortfolioNavSeries,
  firstExecutionDateForCandidates,
  latestPriceOnOrBefore,
  PORTFOLIO_BENCHMARK_SYMBOL,
  PORTFOLIO_METHODOLOGY_VERSION,
  PORTFOLIO_PROVIDER,
  type MarketPricePoint,
  type PortfolioSnapshotDefinition,
  type PortfolioTrack,
} from "../src/lib/portfolio-performance-engine";

type PriceBundle = {
  provider: string;
  benchmark_symbol: string;
  assets: Record<
    string,
    Array<{
      symbol: string;
      date: string;
      adjusted_close_local: number;
      currency: string;
      fx_to_usd: number;
      adjusted_close_usd: number;
    }>
  >;
  errors?: Array<{ symbol: string; error: string }>;
};

type CliArgs = {
  track: PortfolioTrack;
  startCutoff: string;
  throughDate: string;
  replaceBacktest: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NY_TIME_ZONE = "America/New_York";

function parseCliArgs(): CliArgs {
  const values = process.argv.slice(2);
  const valueFor = (name: string): string | null => {
    const index = values.indexOf(name);
    return index >= 0 ? values[index + 1] || null : null;
  };
  const rawTrack = valueFor("--track") || "paper";
  if (rawTrack !== "paper" && rawTrack !== "backtest") {
    throw new Error("--track must be paper or backtest.");
  }
  const track: PortfolioTrack = rawTrack;
  const throughDate = valueFor("--through") || new Date().toISOString().slice(0, 10);
  const startCutoff = valueFor("--start-cutoff") || "2026-04-30";
  for (const [name, value] of [["--through", throughDate], ["--start-cutoff", startCutoff]]) {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed) || isoDate(new Date(parsed)) !== value) {
      throw new Error(`${name} must be a valid YYYY-MM-DD date.`);
    }
  }
  return {
    track,
    startCutoff,
    throughDate,
    replaceBacktest: values.includes("--replace-backtest"),
  };
}

function nyDateParts(value: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function nyDateString(value: Date): string {
  const parts = nyDateParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function timeZoneOffsetMs(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const representedUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return representedUtc - value.getTime();
}

function cutoffAtForNyDate(dateValue: string): Date {
  const [year, month, day] = dateValue.split("-").map(Number);
  const localGuess = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
  const firstOffset = timeZoneOffsetMs(localGuess, NY_TIME_ZONE);
  const firstUtc = new Date(localGuess.getTime() - firstOffset);
  const correctedOffset = timeZoneOffsetMs(firstUtc, NY_TIME_ZONE);
  return new Date(localGuess.getTime() - correctedOffset);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(dateValue: string, days: number): string {
  return isoDate(new Date(Date.parse(`${dateValue}T00:00:00Z`) + days * DAY_MS));
}

function previousNyCalendarDay(now: Date): string {
  const parts = nyDateParts(now);
  return isoDate(new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - DAY_MS));
}

function previousMonthEnd(now: Date): string {
  const parts = nyDateParts(now);
  return isoDate(new Date(Date.UTC(parts.year, parts.month - 1, 0)));
}

function monthlyCutoffDates(startDate: string, endDate: string): string[] {
  const [startYear, startMonth] = startDate.split("-").map(Number);
  const output: string[] = [];
  let cursor = new Date(Date.UTC(startYear, startMonth, 0));
  while (isoDate(cursor) <= endDate) {
    if (isoDate(cursor) >= startDate) output.push(isoDate(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 2, 0));
  }
  return output;
}

function runPriceProvider(payload: object): Promise<PriceBundle> {
  const repoRoot = path.resolve(process.cwd(), "..");
  const script = path.resolve(repoRoot, "scripts", "portfolio_prices.py");
  const python = process.env.PYTHON_EXECUTABLE || "python";
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: path.resolve(repoRoot, "src"), PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `portfolio_prices.py exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as PriceBundle);
      } catch (error) {
        reject(new Error(`Invalid portfolio price JSON: ${String(error)}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function flattenPriceBundle(bundle: PriceBundle): MarketPricePoint[] {
  return Object.values(bundle.assets || {}).flatMap((rows) => rows.map((row) => ({
    symbol: row.symbol,
    date: row.date,
    adjustedCloseLocal: Number(row.adjusted_close_local),
    currency: row.currency,
    fxToUsd: Number(row.fx_to_usd),
    adjustedCloseUsd: Number(row.adjusted_close_usd),
  })));
}

function reportsVisibleAt(
  reports: PortfolioReportInput[],
  cutoffAt: Date,
  track: PortfolioTrack,
): PortfolioReportInput[] {
  const cutoffMs = cutoffAt.getTime();
  const windowStart = cutoffMs - 90 * DAY_MS;
  const visible = reports.filter((report) => {
    const generatedMs = Date.parse(report.generatedAt);
    if (generatedMs < windowStart || generatedMs > cutoffMs || isExcludedTicker(report.ticker)) return false;
    if (track === "paper" && Date.parse(report.createdAt) > cutoffMs) return false;
    return report.deletedAt === null || Date.parse(report.deletedAt) > cutoffMs;
  });
  const deduped = new Map<string, PortfolioReportInput>();
  for (const report of visible.sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt))) {
    const key = report.sourceRunId ? `${report.ticker}:${report.sourceRunId}` : report.id;
    deduped.set(key, report);
  }
  return Array.from(deduped.values());
}

function groupSnapshotsByLens(snapshots: PortfolioSnapshotDefinition[]): PortfolioSnapshotDefinition[][] {
  const grouped = new Map<string, PortfolioSnapshotDefinition[]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.lens.type}:${snapshot.lens.key || "overall"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(snapshot);
  }
  return Array.from(grouped.values());
}

function lensMapKey(lens: DiscoveryLensSelection): string {
  return `${lens.type}:${lens.key || "overall"}`;
}

async function main() {
  const args = parseCliArgs();
  if (args.replaceBacktest && args.track !== "backtest") {
    throw new Error("--replace-backtest is only valid with --track backtest.");
  }
  const owner = `${process.env.HOSTNAME || "local"}:${process.pid}:${randomUUID()}`;
  const lockKey = `portfolio-performance:${args.track}:${PORTFOLIO_METHODOLOGY_VERSION}`;
  if (!(await acquirePortfolioRefreshLock(lockKey, owner))) {
    console.log(`[portfolio] ${lockKey} is already running; exiting cleanly.`);
    return;
  }

  try {
    if (args.replaceBacktest) {
      await deletePortfolioTrack("backtest", PORTFOLIO_METHODOLOGY_VERSION);
    }
    let existing = await loadPortfolioSnapshots(args.track, PORTFOLIO_METHODOLOGY_VERSION);
    const now = new Date();
    let cutoffs: string[];
    if (args.track === "backtest") {
      cutoffs = monthlyCutoffDates(args.startCutoff, previousMonthEnd(new Date(`${args.throughDate}T23:59:59Z`)));
    } else if (!existing.length) {
      cutoffs = [previousNyCalendarDay(now)];
    } else {
      const existingCutoffDates = Array.from(new Set(
        existing.map((snapshot) => nyDateString(new Date(snapshot.cutoffAt))),
      )).sort();
      const latestCutoffDate = existingCutoffDates[existingCutoffDates.length - 1];
      cutoffs = Array.from(new Set([
        ...existingCutoffDates,
        ...monthlyCutoffDates(addDays(latestCutoffDate, 1), previousMonthEnd(now)),
      ])).sort();
    }

    const allCutoffDates = [...cutoffs, ...existing.map((snapshot) => nyDateString(new Date(snapshot.cutoffAt)))];
    const earliestCutoff = allCutoffDates.sort()[0] || previousNyCalendarDay(now);
    const earliestReport = addDays(earliestCutoff, -90);
    const reports = await listPortfolioReportInputs({
      earliestGeneratedAt: `${earliestReport}T00:00:00Z`,
      latestGeneratedAt: `${args.throughDate}T23:59:59Z`,
    });
    const currencyByTicker = new Map<string, string>();
    for (const report of reports) currencyByTicker.set(report.ticker, report.currency);
    for (const snapshot of existing) {
      for (const holding of snapshot.holdings) currencyByTicker.set(holding.ticker, holding.currency);
    }
    const instruments = Array.from(currencyByTicker.entries()).map(([symbol, currency]) => ({ symbol, currency }));
    const priceStart = addDays(earliestCutoff, -10);
    const priceBundle = await runPriceProvider({
      start: priceStart,
      end: args.throughDate,
      instruments,
      workers: Number(process.env.PORTFOLIO_PRICE_WORKERS || 8),
    });
    const fetchedPoints = flattenPriceBundle(priceBundle);
    await upsertMarketPrices(fetchedPoints, PORTFOLIO_PROVIDER);
    const symbols = Array.from(new Set([...currencyByTicker.keys(), PORTFOLIO_BENCHMARK_SYMBOL]));
    const priceBySymbol = await loadMarketPrices({
      symbols,
      startDate: priceStart,
      endDate: args.throughDate,
      source: PORTFOLIO_PROVIDER,
    });
    const benchmarkPoints = priceBySymbol.get(PORTFOLIO_BENCHMARK_SYMBOL) || [];
    const knownLenses = new Map<string, DiscoveryLensSelection>();
    const lensFirstCutoff = new Map<string, string>();
    knownLenses.set("overall:overall", { type: "overall", key: null, label: "Overall" });
    lensFirstCutoff.set("overall:overall", earliestCutoff);
    for (const snapshot of existing) {
      const key = lensMapKey(snapshot.lens);
      const cutoffDate = nyDateString(new Date(snapshot.cutoffAt));
      knownLenses.set(key, snapshot.lens);
      const previous = lensFirstCutoff.get(key);
      if (!previous || cutoffDate < previous) lensFirstCutoff.set(key, cutoffDate);
    }

    for (const cutoffDate of cutoffs) {
      const cutoffAt = cutoffAtForNyDate(cutoffDate);
      if (!benchmarkPoints.some((point) => point.date > cutoffDate)) {
        console.warn(`[portfolio] no benchmark session after ${cutoffDate}; snapshot deferred.`);
        continue;
      }
      const visibleReports = reportsVisibleAt(reports, cutoffAt, args.track);
      const discoveryReports: DiscoverySourceReport[] = visibleReports.map((report) => ({
        ticker: report.ticker,
        generatedAt: report.generatedAt,
        payload: report.dashboard,
        reportId: report.id,
      }));
      const localPriceByTicker = new Map<string, number | null>();
      for (const ticker of new Set(discoveryReports.map((report) => report.ticker))) {
        const point = latestPriceOnOrBefore(priceBySymbol.get(ticker) || [], cutoffDate);
        localPriceByTicker.set(ticker, point?.adjustedCloseLocal ?? null);
      }
      const universe = prepareDiscoveryUniverse({
        reports: discoveryReports,
        priceByTicker: localPriceByTicker,
        asOfMs: cutoffAt.getTime(),
      });
      for (const lens of allDiscoveryLenses(universe)) {
        const key = lensMapKey(lens);
        knownLenses.set(key, lens);
        if (!lensFirstCutoff.has(key)) lensFirstCutoff.set(key, cutoffDate);
      }
      let createdForCutoff = 0;
      for (const lens of knownLenses.values()) {
        if (String(lensFirstCutoff.get(lensMapKey(lens)) || cutoffDate) > cutoffDate) continue;
        const candidates = scoreDiscoveryCandidates(universe, lens);
        const executionDate = firstExecutionDateForCandidates({
          candidates,
          cutoffDate,
          benchmarkPoints,
          priceBySymbol,
        });
        if (!executionDate) {
          console.warn(`[portfolio] ${lens.type}:${lens.key || "overall"} has no common execution session after ${cutoffDate}; snapshot deferred.`);
          continue;
        }
        const holdings = buildHoldingsForSnapshot({
          candidates,
          executionDate,
          priceBySymbol,
          currencyByTicker,
        });
        await insertPortfolioSnapshot({
          track: args.track,
          lens,
          cutoffAt: cutoffAt.toISOString(),
          executionDate,
          methodologyVersion: PORTFOLIO_METHODOLOGY_VERSION,
          candidateCount: candidates.length,
          status: holdings.length ? "ready" : "no_positions",
          holdings,
        });
        createdForCutoff += 1;
      }
      console.log(`[portfolio] ${args.track} cutoff ${cutoffDate}: ${createdForCutoff} snapshots (${visibleReports.length} reports).`);
    }

    existing = await loadPortfolioSnapshots(args.track, PORTFOLIO_METHODOLOGY_VERSION);
    for (const lensSnapshots of groupSnapshotsByLens(existing)) {
      const first = lensSnapshots[0];
      const nav = computePortfolioNavSeries({
        snapshots: lensSnapshots,
        priceBySymbol,
        benchmarkPoints,
        throughDate: args.throughDate,
      });
      await upsertPortfolioNav({
        track: args.track,
        lensType: first.lens.type,
        lensKey: first.lens.key || "overall",
        methodologyVersion: PORTFOLIO_METHODOLOGY_VERSION,
        points: nav,
      });
    }
    if (priceBundle.errors?.length) {
      console.warn(`[portfolio] provider returned ${priceBundle.errors.length} symbol warnings.`);
    }
    console.log(`[portfolio] refreshed ${args.track}: ${existing.length} snapshots, ${fetchedPoints.length} price rows.`);
  } finally {
    await releasePortfolioRefreshLock(lockKey, owner);
  }
}

main().catch((error) => {
  console.error(`[portfolio] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
