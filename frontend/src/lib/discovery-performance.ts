import { getSql } from "@/lib/db";
import { buildDiscoveryPayload, DiscoveryLensType, LensSelection } from "@/lib/discovery-core";

type StrategyId =
  | "most_undervalued_top10"
  | "most_undervalued_top20"
  | "highest_allocation_top10"
  | "highest_allocation_top20";

type BenchmarkId = "^GSPC";

type StrategyDefinition = {
  id: StrategyId;
  label: string;
  topCount: 10 | 20;
  source: "top_undervalued" | "top_highest_allocation";
};

type PriceSnapshot = {
  date: string;
  close: number;
};

type NavRow = {
  nav_date: string;
  nav: number;
  daily_return: number;
};

type HoldingRow = {
  ticker: string;
  target_weight: number;
  close_price: number;
};

type DiscoveryPerformancePoint = {
  date: string;
  nav: number;
  cumulative_return_pct: number;
};

type DiscoveryPerformanceSeries = {
  key: string;
  label: string;
  points: DiscoveryPerformancePoint[];
  latest_stats: {
    nav: number | null;
    cumulative_return_pct: number | null;
    daily_return_pct: number | null;
    max_drawdown_pct: number | null;
  };
};

export type DiscoveryPerformancePayload = {
  generated_at: string;
  trade_date: string | null;
  lens: LensSelection;
  series: DiscoveryPerformanceSeries[];
  windows: Record<string, { key: string; label: string; start_date: string | null }>;
};

const BENCHMARK_ID: BenchmarkId = "^GSPC";
const OVERALL_LENS_KEY = "__overall__";

const STRATEGIES: StrategyDefinition[] = [
  {
    id: "most_undervalued_top10",
    label: "Most Undervalued Top 10",
    topCount: 10,
    source: "top_undervalued",
  },
  {
    id: "most_undervalued_top20",
    label: "Most Undervalued Top 20",
    topCount: 20,
    source: "top_undervalued",
  },
  {
    id: "highest_allocation_top10",
    label: "Highest Allocation Top 10",
    topCount: 10,
    source: "top_highest_allocation",
  },
  {
    id: "highest_allocation_top20",
    label: "Highest Allocation Top 20",
    topCount: 20,
    source: "top_highest_allocation",
  },
];

function safeNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDateFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function addDays(isoDate: string, deltaDays: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms + deltaDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function lensForStorage(lens: LensSelection): { lensType: DiscoveryLensType; lensKey: string } {
  return {
    lensType: lens.type,
    lensKey: lens.key || OVERALL_LENS_KEY,
  };
}

async function ensurePerformanceTables(): Promise<void> {
  const sql = getSql();
  if (!sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS discovery_strategy_nav (
      strategy_id TEXT NOT NULL,
      lens_type TEXT NOT NULL,
      lens_key TEXT NOT NULL,
      nav_date DATE NOT NULL,
      nav DOUBLE PRECISION NOT NULL,
      daily_return DOUBLE PRECISION NOT NULL DEFAULT 0,
      turnover DOUBLE PRECISION NOT NULL DEFAULT 0,
      holdings_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (strategy_id, lens_type, lens_key, nav_date)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_discovery_strategy_nav_date
      ON discovery_strategy_nav (nav_date DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS discovery_strategy_holdings (
      strategy_id TEXT NOT NULL,
      lens_type TEXT NOT NULL,
      lens_key TEXT NOT NULL,
      nav_date DATE NOT NULL,
      ticker TEXT NOT NULL,
      rank INTEGER NOT NULL,
      target_weight DOUBLE PRECISION NOT NULL,
      close_price DOUBLE PRECISION,
      PRIMARY KEY (strategy_id, lens_type, lens_key, nav_date, ticker)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_discovery_strategy_holdings_date
      ON discovery_strategy_holdings (nav_date DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS discovery_benchmark_nav (
      benchmark_id TEXT NOT NULL,
      nav_date DATE NOT NULL,
      nav DOUBLE PRECISION NOT NULL,
      daily_return DOUBLE PRECISION NOT NULL DEFAULT 0,
      close_price DOUBLE PRECISION,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (benchmark_id, nav_date)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_discovery_benchmark_nav_date
      ON discovery_benchmark_nav (nav_date DESC)
  `;
}

async function fetchLatestDailyClose(ticker: string): Promise<PriceSnapshot | null> {
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
    url.searchParams.set("interval", "1d");
    url.searchParams.set("range", "2mo");
    url.searchParams.set("includePrePost", "false");
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        "user-agent": "ai-hedge-discovery/1.0",
      },
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const result = raw?.chart?.result?.[0];
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
      ? result.indicators!.quote![0]!.close!
      : [];

    for (let i = Math.min(timestamps.length, closes.length) - 1; i >= 0; i -= 1) {
      const ts = Number(timestamps[i]);
      const close = safeNum(closes[i]);
      if (!Number.isFinite(ts) || typeof close !== "number" || close <= 0) continue;
      return {
        date: toIsoDateFromUnixSeconds(ts),
        close,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchLatestDailyCloses(tickers: string[]): Promise<Record<string, PriceSnapshot | null>> {
  const uniq = Array.from(new Set(tickers.map((t) => String(t || "").trim().toUpperCase()).filter(Boolean)));
  if (!uniq.length) return {};
  const entries = await Promise.all(
    uniq.map(async (ticker) => {
      const snapshot = await fetchLatestDailyClose(ticker);
      return [ticker, snapshot] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function fetchLatestNavRows(
  strategyId: StrategyId,
  lensType: DiscoveryLensType,
  lensKey: string,
): Promise<NavRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT nav_date::text AS nav_date,
           nav::float8 AS nav,
           daily_return::float8 AS daily_return
      FROM discovery_strategy_nav
     WHERE strategy_id = ${strategyId}
       AND lens_type = ${lensType}
       AND lens_key = ${lensKey}
     ORDER BY nav_date DESC
     LIMIT 2
  `) as unknown as NavRow[];
  return rows;
}

async function fetchLatestBenchmarkRows(benchmarkId: BenchmarkId): Promise<Array<NavRow & { close_price: number | null }>> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT nav_date::text AS nav_date,
           nav::float8 AS nav,
           daily_return::float8 AS daily_return,
           close_price::float8 AS close_price
      FROM discovery_benchmark_nav
     WHERE benchmark_id = ${benchmarkId}
     ORDER BY nav_date DESC
     LIMIT 2
  `) as unknown as Array<NavRow & { close_price: number | null }>;
  return rows;
}

async function fetchHoldingsForDate(
  strategyId: StrategyId,
  lensType: DiscoveryLensType,
  lensKey: string,
  navDate: string,
): Promise<HoldingRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT ticker,
           target_weight::float8 AS target_weight,
           close_price::float8 AS close_price
      FROM discovery_strategy_holdings
     WHERE strategy_id = ${strategyId}
       AND lens_type = ${lensType}
       AND lens_key = ${lensKey}
       AND nav_date = ${navDate}::date
     ORDER BY rank ASC, ticker ASC
  `) as unknown as HoldingRow[];
  return rows;
}

function computeTurnover(prevWeights: Map<string, number>, nextWeights: Map<string, number>): number {
  const tickers = new Set<string>([...prevWeights.keys(), ...nextWeights.keys()]);
  let sumAbs = 0;
  for (const ticker of tickers) {
    const prev = prevWeights.get(ticker) || 0;
    const next = nextWeights.get(ticker) || 0;
    sumAbs += Math.abs(next - prev);
  }
  return sumAbs / 2;
}

function computeMaxDrawdownPct(points: DiscoveryPerformancePoint[]): number | null {
  if (!points.length) return null;
  let peak = points[0].nav;
  let maxDrawdown = 0;
  for (const point of points) {
    if (point.nav > peak) peak = point.nav;
    if (peak <= 0) continue;
    const dd = ((point.nav - peak) / peak) * 100;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  return maxDrawdown;
}

async function upsertStrategyDay(args: {
  strategy: StrategyDefinition;
  lensType: DiscoveryLensType;
  lensKey: string;
  tradeDate: string;
  candidateTickers: string[];
  priceMap: Record<string, PriceSnapshot | null>;
}): Promise<void> {
  const sql = getSql();
  if (!sql) return;

  const latestRows = await fetchLatestNavRows(args.strategy.id, args.lensType, args.lensKey);
  const todayRow = latestRows.find((row) => row.nav_date === args.tradeDate) || null;
  const prevRow = latestRows.find((row) => row.nav_date < args.tradeDate) || null;

  const prevHoldings = prevRow
    ? await fetchHoldingsForDate(args.strategy.id, args.lensType, args.lensKey, prevRow.nav_date)
    : [];

  const validCandidates = args.candidateTickers.filter((ticker) => {
    const close = args.priceMap[ticker]?.close;
    return typeof close === "number" && Number.isFinite(close) && close > 0;
  });

  const nextWeight = validCandidates.length ? 1 / validCandidates.length : 0;
  const nextWeightMap = new Map<string, number>(
    validCandidates.map((ticker) => [ticker, nextWeight] as const),
  );

  let dailyReturn = 0;
  let nav = 100;
  if (prevRow) {
    const validReturns: number[] = [];
    for (const holding of prevHoldings) {
      const prevClose = safeNum(holding.close_price);
      const currClose = safeNum(args.priceMap[holding.ticker]?.close);
      if (typeof prevClose !== "number" || prevClose <= 0) continue;
      if (typeof currClose !== "number" || currClose <= 0) continue;
      validReturns.push((currClose / prevClose) - 1);
    }
    if (validReturns.length) {
      dailyReturn = validReturns.reduce((sum, value) => sum + value, 0) / validReturns.length;
    } else {
      dailyReturn = 0;
    }
    nav = prevRow.nav * (1 + dailyReturn);
  }

  const prevWeightMap = new Map<string, number>();
  for (const holding of prevHoldings) {
    const w = safeNum(holding.target_weight);
    if (typeof w === "number" && Number.isFinite(w) && w > 0) {
      prevWeightMap.set(holding.ticker, w);
    }
  }
  const turnover = computeTurnover(prevWeightMap, nextWeightMap);

  await sql`
    INSERT INTO discovery_strategy_nav (
      strategy_id,
      lens_type,
      lens_key,
      nav_date,
      nav,
      daily_return,
      turnover,
      holdings_count,
      updated_at
    ) VALUES (
      ${args.strategy.id},
      ${args.lensType},
      ${args.lensKey},
      ${args.tradeDate}::date,
      ${nav},
      ${dailyReturn},
      ${turnover},
      ${validCandidates.length},
      now()
    )
    ON CONFLICT (strategy_id, lens_type, lens_key, nav_date)
    DO UPDATE SET
      nav = EXCLUDED.nav,
      daily_return = EXCLUDED.daily_return,
      turnover = EXCLUDED.turnover,
      holdings_count = EXCLUDED.holdings_count,
      updated_at = now()
  `;

  await sql`
    DELETE FROM discovery_strategy_holdings
     WHERE strategy_id = ${args.strategy.id}
       AND lens_type = ${args.lensType}
       AND lens_key = ${args.lensKey}
       AND nav_date = ${args.tradeDate}::date
  `;

  for (let i = 0; i < validCandidates.length; i += 1) {
    const ticker = validCandidates[i];
    const closePrice = args.priceMap[ticker]?.close ?? null;
    await sql`
      INSERT INTO discovery_strategy_holdings (
        strategy_id,
        lens_type,
        lens_key,
        nav_date,
        ticker,
        rank,
        target_weight,
        close_price
      ) VALUES (
        ${args.strategy.id},
        ${args.lensType},
        ${args.lensKey},
        ${args.tradeDate}::date,
        ${ticker},
        ${i + 1},
        ${nextWeight},
        ${closePrice}
      )
    `;
  }

  void todayRow;
}

async function upsertBenchmarkDay(tradeDate: string, closePrice: number): Promise<void> {
  const sql = getSql();
  if (!sql) return;

  const latestRows = await fetchLatestBenchmarkRows(BENCHMARK_ID);
  const prevRow = latestRows.find((row) => row.nav_date < tradeDate) || null;

  let dailyReturn = 0;
  let nav = 100;
  if (prevRow && typeof prevRow.close_price === "number" && prevRow.close_price > 0) {
    dailyReturn = (closePrice / prevRow.close_price) - 1;
    nav = prevRow.nav * (1 + dailyReturn);
  }

  await sql`
    INSERT INTO discovery_benchmark_nav (
      benchmark_id,
      nav_date,
      nav,
      daily_return,
      close_price,
      updated_at
    ) VALUES (
      ${BENCHMARK_ID},
      ${tradeDate}::date,
      ${nav},
      ${dailyReturn},
      ${closePrice},
      now()
    )
    ON CONFLICT (benchmark_id, nav_date)
    DO UPDATE SET
      nav = EXCLUDED.nav,
      daily_return = EXCLUDED.daily_return,
      close_price = EXCLUDED.close_price,
      updated_at = now()
  `;
}

async function fetchStrategySeries(
  lensType: DiscoveryLensType,
  lensKey: string,
): Promise<Record<StrategyId, Array<{ nav_date: string; nav: number; daily_return: number }>>> {
  const sql = getSql();
  if (!sql) {
    return {
      most_undervalued_top10: [],
      most_undervalued_top20: [],
      highest_allocation_top10: [],
      highest_allocation_top20: [],
    };
  }

  const rows = (await sql`
    SELECT strategy_id,
           nav_date::text AS nav_date,
           nav::float8 AS nav,
           daily_return::float8 AS daily_return
      FROM discovery_strategy_nav
     WHERE lens_type = ${lensType}
       AND lens_key = ${lensKey}
     ORDER BY nav_date ASC
  `) as unknown as Array<{
    strategy_id: StrategyId;
    nav_date: string;
    nav: number;
    daily_return: number;
  }>;

  const grouped: Record<StrategyId, Array<{ nav_date: string; nav: number; daily_return: number }>> = {
    most_undervalued_top10: [],
    most_undervalued_top20: [],
    highest_allocation_top10: [],
    highest_allocation_top20: [],
  };

  for (const row of rows) {
    if (!grouped[row.strategy_id]) continue;
    grouped[row.strategy_id].push({
      nav_date: row.nav_date,
      nav: row.nav,
      daily_return: row.daily_return,
    });
  }

  return grouped;
}

async function fetchBenchmarkSeries(): Promise<Array<{ nav_date: string; nav: number; daily_return: number }>> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT nav_date::text AS nav_date,
           nav::float8 AS nav,
           daily_return::float8 AS daily_return
      FROM discovery_benchmark_nav
     WHERE benchmark_id = ${BENCHMARK_ID}
     ORDER BY nav_date ASC
  `) as unknown as Array<{ nav_date: string; nav: number; daily_return: number }>;
  return rows;
}

function toPoints(rows: Array<{ nav_date: string; nav: number }>): DiscoveryPerformancePoint[] {
  return rows
    .filter((row) => typeof row.nav === "number" && Number.isFinite(row.nav) && row.nav > 0)
    .map((row) => ({
      date: row.nav_date,
      nav: row.nav,
      cumulative_return_pct: ((row.nav / 100) - 1) * 100,
    }));
}

function toSeries(
  key: string,
  label: string,
  rows: Array<{ nav_date: string; nav: number; daily_return: number }>,
): DiscoveryPerformanceSeries {
  const points = toPoints(rows);
  const last = points[points.length - 1] || null;
  const lastDailyReturn = rows.length ? rows[rows.length - 1].daily_return : null;
  return {
    key,
    label,
    points,
    latest_stats: {
      nav: last?.nav ?? null,
      cumulative_return_pct: last?.cumulative_return_pct ?? null,
      daily_return_pct:
        typeof lastDailyReturn === "number" && Number.isFinite(lastDailyReturn)
          ? lastDailyReturn * 100
          : null,
      max_drawdown_pct: computeMaxDrawdownPct(points),
    },
  };
}

function buildWindows(latestDate: string | null): Record<string, { key: string; label: string; start_date: string | null }> {
  if (!latestDate) {
    return {
      "1w": { key: "1w", label: "1W", start_date: null },
      "1m": { key: "1m", label: "1M", start_date: null },
      "1y": { key: "1y", label: "1Y", start_date: null },
      all: { key: "all", label: "All", start_date: null },
    };
  }

  return {
    "1w": { key: "1w", label: "1W", start_date: addDays(latestDate, -7) },
    "1m": { key: "1m", label: "1M", start_date: addDays(latestDate, -30) },
    "1y": { key: "1y", label: "1Y", start_date: addDays(latestDate, -365) },
    all: { key: "all", label: "All", start_date: null },
  };
}

function normalizeLensFromRequest(params: {
  lensType?: string | null;
  lensKey?: string | null;
}): LensSelection {
  const rawType = String(params.lensType || "").trim().toLowerCase();
  const rawKey = String(params.lensKey || "").trim();
  if (rawType === "model" && rawKey) {
    return { type: "model", key: rawKey, label: `Model: ${rawKey}` };
  }
  if (rawType === "valuator" && rawKey) {
    return { type: "valuator", key: rawKey, label: `Valuator: ${rawKey}` };
  }
  return { type: "overall", key: null, label: "Overall" };
}

export async function buildDiscoveryPerformancePayload(params: {
  lensType?: string | null;
  lensKey?: string | null;
  refresh?: boolean;
} = {}): Promise<DiscoveryPerformancePayload> {
  const refresh = params.refresh !== false;
  const requestedLens = normalizeLensFromRequest(params);

  const sql = getSql();
  if (!sql) {
    return {
      generated_at: new Date().toISOString(),
      trade_date: null,
      lens: requestedLens,
      series: [],
      windows: buildWindows(null),
    };
  }

  await ensurePerformanceTables();

  if (!refresh) {
    const lensStorage = lensForStorage(requestedLens);
    const grouped = await fetchStrategySeries(lensStorage.lensType, lensStorage.lensKey);
    const benchmarkRows = await fetchBenchmarkSeries();
    const series = [
      ...STRATEGIES.map((strategy) =>
        toSeries(strategy.id, strategy.label, grouped[strategy.id] || []),
      ),
      toSeries("benchmark_sp500", "S&P 500", benchmarkRows),
    ];
    const latestDate = series
      .flatMap((line) => line.points.map((point) => point.date))
      .sort()
      .at(-1) || null;
    return {
      generated_at: new Date().toISOString(),
      trade_date: latestDate,
      lens: requestedLens,
      series,
      windows: buildWindows(latestDate),
    };
  }

  const discovery = await buildDiscoveryPayload({
    lensType: params.lensType,
    lensKey: params.lensKey,
  });

  const benchmarkSnapshot = await fetchLatestDailyClose(BENCHMARK_ID);
  if (!benchmarkSnapshot) {
    const lensStorage = lensForStorage(discovery.lens);
    const grouped = await fetchStrategySeries(lensStorage.lensType, lensStorage.lensKey);
    const benchmarkRows = await fetchBenchmarkSeries();
    const series = [
      ...STRATEGIES.map((strategy) =>
        toSeries(strategy.id, strategy.label, grouped[strategy.id] || []),
      ),
      toSeries("benchmark_sp500", "S&P 500", benchmarkRows),
    ];
    const latestDate = series
      .flatMap((line) => line.points.map((point) => point.date))
      .sort()
      .at(-1) || null;
    return {
      generated_at: new Date().toISOString(),
      trade_date: latestDate,
      lens: discovery.lens,
      series,
      windows: buildWindows(latestDate),
    };
  }

  const tradeDate = benchmarkSnapshot.date;
  const lensStorage = lensForStorage(discovery.lens);

  const strategyTickers: Record<StrategyId, string[]> = {
    most_undervalued_top10: discovery.top_undervalued.slice(0, 10).map((row) => row.ticker),
    most_undervalued_top20: discovery.top_undervalued.slice(0, 20).map((row) => row.ticker),
    highest_allocation_top10: discovery.top_highest_allocation.slice(0, 10).map((row) => row.ticker),
    highest_allocation_top20: discovery.top_highest_allocation.slice(0, 20).map((row) => row.ticker),
  };

  const prevHoldingTickers = new Set<string>();
  for (const strategy of STRATEGIES) {
    const latestRows = await fetchLatestNavRows(strategy.id, lensStorage.lensType, lensStorage.lensKey);
    const prevRow = latestRows.find((row) => row.nav_date < tradeDate) || null;
    if (!prevRow) continue;
    const holdings = await fetchHoldingsForDate(strategy.id, lensStorage.lensType, lensStorage.lensKey, prevRow.nav_date);
    for (const holding of holdings) {
      prevHoldingTickers.add(holding.ticker);
    }
  }

  const tickerUniverse = new Set<string>();
  for (const strategy of STRATEGIES) {
    for (const ticker of strategyTickers[strategy.id]) tickerUniverse.add(ticker);
  }
  for (const ticker of prevHoldingTickers) tickerUniverse.add(ticker);

  const priceMap = await fetchLatestDailyCloses(Array.from(tickerUniverse));

  for (const strategy of STRATEGIES) {
    await upsertStrategyDay({
      strategy,
      lensType: lensStorage.lensType,
      lensKey: lensStorage.lensKey,
      tradeDate,
      candidateTickers: strategyTickers[strategy.id],
      priceMap,
    });
  }

  await upsertBenchmarkDay(tradeDate, benchmarkSnapshot.close);

  const grouped = await fetchStrategySeries(lensStorage.lensType, lensStorage.lensKey);
  const benchmarkRows = await fetchBenchmarkSeries();
  const series = [
    ...STRATEGIES.map((strategy) =>
      toSeries(strategy.id, strategy.label, grouped[strategy.id] || []),
    ),
    toSeries("benchmark_sp500", "S&P 500", benchmarkRows),
  ];
  const latestDate = series
    .flatMap((line) => line.points.map((point) => point.date))
    .sort()
    .at(-1) || tradeDate;

  return {
    generated_at: new Date().toISOString(),
    trade_date: tradeDate,
    lens: discovery.lens,
    series,
    windows: buildWindows(latestDate),
  };
}
