import { randomUUID } from "node:crypto";

import type { DashboardPayload } from "@/lib/dashboard-types";
import { getSql } from "@/lib/db";
import type {
  MarketPricePoint,
  PortfolioNavPoint,
  PortfolioSnapshotDefinition,
  PortfolioTrack,
} from "@/lib/portfolio-performance-engine";

export type PortfolioReportInput = {
  id: string;
  ticker: string;
  generatedAt: string;
  createdAt: string;
  deletedAt: string | null;
  sourceRunId: string | null;
  currency: string;
  dashboard: DashboardPayload;
};

export type StoredPortfolioNavPoint = PortfolioNavPoint & {
  lensType: "overall" | "model" | "valuator";
  lensKey: string;
  lensLabel: string;
  methodologyVersion: string;
};

type SnapshotRow = {
  id: string;
  track: PortfolioTrack;
  lens_type: "overall" | "model" | "valuator";
  lens_key: string;
  lens_label: string;
  cutoff_at: string;
  execution_date: string;
  methodology_version: string;
  candidate_count: number;
  status: "ready" | "no_positions";
};

type HoldingRow = {
  snapshot_id: string;
  rank: number;
  ticker: string;
  score: number;
  weight: number;
  currency: string;
  source_report_ids: string[] | null;
  entry_date: string;
  entry_price_usd: number;
};

function requireSql() {
  const sql = getSql();
  if (!sql) throw new Error("DATABASE_URL is required for portfolio performance.");
  return sql;
}

export async function acquirePortfolioRefreshLock(lockKey: string, owner: string): Promise<boolean> {
  const sql = requireSql();
  await sql`
    DELETE FROM portfolio_refresh_locks
     WHERE lock_key = ${lockKey}
       AND acquired_at < now() - interval '2 hours';
  `;
  const rows = (await sql`
    INSERT INTO portfolio_refresh_locks (lock_key, owner)
    VALUES (${lockKey}, ${owner})
    ON CONFLICT (lock_key) DO NOTHING
    RETURNING lock_key;
  `) as Array<{ lock_key: string }>;
  return rows.length > 0;
}

export async function releasePortfolioRefreshLock(lockKey: string, owner: string): Promise<void> {
  const sql = requireSql();
  await sql`DELETE FROM portfolio_refresh_locks WHERE lock_key = ${lockKey} AND owner = ${owner};`;
}

export async function listPortfolioReportInputs(args: {
  earliestGeneratedAt: string;
  latestGeneratedAt: string;
}): Promise<PortfolioReportInput[]> {
  const sql = requireSql();
  type ReportRow = {
    id: string;
    ticker: string;
    generated_at: string;
    created_at: string;
    deleted_at: string | null;
    source_run_id: string | null;
    currency: string;
    dashboard: DashboardPayload;
  };
  const rows: ReportRow[] = [];
  const pageSize = 20;
  for (let offset = 0; ; offset += pageSize) {
    const page = (await sql`
      SELECT r.id::text AS id,
             r.ticker,
             r.generated_at::text AS generated_at,
             r.created_at::text AS created_at,
             r.deleted_at::text AS deleted_at,
             r.source_run_id,
             COALESCE(NULLIF(t.currency, ''), NULLIF(a.dashboard->'header'->>'currency', ''), 'USD') AS currency,
             a.dashboard
        FROM reports r
        JOIN report_artifacts a ON a.report_id = r.id
        JOIN tickers t ON t.symbol = r.ticker
       WHERE r.generated_at >= ${args.earliestGeneratedAt}::timestamptz
         AND r.generated_at <= ${args.latestGeneratedAt}::timestamptz
       ORDER BY r.generated_at, r.id
       LIMIT ${pageSize}
      OFFSET ${offset};
    `) as ReportRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map((row) => ({
    id: row.id,
    ticker: String(row.ticker || "").toUpperCase(),
    generatedAt: new Date(row.generated_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    sourceRunId: row.source_run_id,
    currency: String(row.currency || "USD").toUpperCase(),
    dashboard: row.dashboard,
  }));
}

export async function upsertMarketPrices(points: MarketPricePoint[], source: string): Promise<void> {
  const sql = requireSql();
  const chunkSize = 100;
  for (let index = 0; index < points.length; index += chunkSize) {
    const chunk = points.slice(index, index + chunkSize);
    await sql.transaction((tx) =>
      chunk.map((point) => tx`
        INSERT INTO market_prices_daily (
          symbol, price_date, adjusted_close_local, currency,
          fx_to_usd, adjusted_close_usd, source, fetched_at
        ) VALUES (
          ${point.symbol}, ${point.date}::date, ${point.adjustedCloseLocal}, ${point.currency},
          ${point.fxToUsd}, ${point.adjustedCloseUsd}, ${source}, now()
        )
        ON CONFLICT (symbol, price_date, source) DO UPDATE SET
          adjusted_close_local = EXCLUDED.adjusted_close_local,
          currency = EXCLUDED.currency,
          fx_to_usd = EXCLUDED.fx_to_usd,
          adjusted_close_usd = EXCLUDED.adjusted_close_usd,
          fetched_at = now();
      `),
    );
  }
}

export async function loadMarketPrices(args: {
  symbols: string[];
  startDate: string;
  endDate: string;
  source: string;
}): Promise<Map<string, MarketPricePoint[]>> {
  if (!args.symbols.length) return new Map();
  const sql = requireSql();
  const rows = (await sql`
    SELECT symbol, price_date::text AS price_date,
           adjusted_close_local::float8 AS adjusted_close_local,
           currency,
           fx_to_usd::float8 AS fx_to_usd,
           adjusted_close_usd::float8 AS adjusted_close_usd
      FROM market_prices_daily
     WHERE symbol = ANY(${args.symbols}::text[])
       AND price_date BETWEEN ${args.startDate}::date AND ${args.endDate}::date
       AND source = ${args.source}
     ORDER BY symbol, price_date;
  `) as Array<{
    symbol: string;
    price_date: string;
    adjusted_close_local: number;
    currency: string;
    fx_to_usd: number;
    adjusted_close_usd: number;
  }>;
  const grouped = new Map<string, MarketPricePoint[]>();
  for (const row of rows) {
    if (!grouped.has(row.symbol)) grouped.set(row.symbol, []);
    grouped.get(row.symbol)!.push({
      symbol: row.symbol,
      date: row.price_date,
      adjustedCloseLocal: Number(row.adjusted_close_local),
      currency: row.currency,
      fxToUsd: Number(row.fx_to_usd),
      adjustedCloseUsd: Number(row.adjusted_close_usd),
    });
  }
  return grouped;
}

export async function insertPortfolioSnapshot(
  snapshot: Omit<PortfolioSnapshotDefinition, "id">,
): Promise<PortfolioSnapshotDefinition> {
  const sql = requireSql();
  const lensKey = snapshot.lens.key || "overall";
  const existing = (await sql`
    SELECT id::text AS id
      FROM portfolio_snapshots
     WHERE track = ${snapshot.track}
       AND lens_type = ${snapshot.lens.type}
       AND lens_key = ${lensKey}
       AND cutoff_at = ${snapshot.cutoffAt}::timestamptz
       AND methodology_version = ${snapshot.methodologyVersion}
     LIMIT 1;
  `) as Array<{ id: string }>;
  if (existing[0]) {
    const loaded = await loadPortfolioSnapshots(snapshot.track, snapshot.methodologyVersion);
    const found = loaded.find((row) => row.id === existing[0].id);
    if (!found) throw new Error(`Portfolio snapshot ${existing[0].id} exists but could not be loaded.`);
    return found;
  }

  const id = randomUUID();
  const status = snapshot.holdings.length ? "ready" : "no_positions";
  const cashWeight = snapshot.holdings.length ? 0 : 1;
  await sql.transaction((tx) => [
    tx`
      INSERT INTO portfolio_snapshots (
        id, track, lens_type, lens_key, lens_label, cutoff_at, execution_date,
        methodology_version, candidate_count, selected_count, cash_weight, status
      ) VALUES (
        ${id}::uuid, ${snapshot.track}, ${snapshot.lens.type}, ${lensKey}, ${snapshot.lens.label},
        ${snapshot.cutoffAt}::timestamptz, ${snapshot.executionDate}::date,
        ${snapshot.methodologyVersion}, ${snapshot.candidateCount}, ${snapshot.holdings.length},
        ${cashWeight}, ${status}
      );
    `,
    ...snapshot.holdings.map((holding) => tx`
      INSERT INTO portfolio_holdings (
        snapshot_id, rank, ticker, score, weight, currency,
        source_report_ids, entry_date, entry_price_usd
      ) VALUES (
        ${id}::uuid, ${holding.rank}, ${holding.ticker}, ${holding.score}, ${holding.weight},
        ${holding.currency}, ${holding.sourceReportIds}::uuid[], ${holding.entryDate}::date,
        ${holding.entryPriceUsd}
      );
    `),
  ]);
  return { ...snapshot, id, status };
}

export async function loadPortfolioSnapshots(
  track: PortfolioTrack,
  methodologyVersion: string,
): Promise<PortfolioSnapshotDefinition[]> {
  const sql = requireSql();
  const snapshotRows = (await sql`
    SELECT id::text AS id, track, lens_type, lens_key, lens_label,
           cutoff_at::text AS cutoff_at, execution_date::text AS execution_date,
           methodology_version, candidate_count, status
      FROM portfolio_snapshots
     WHERE track = ${track}
       AND methodology_version = ${methodologyVersion}
       AND status IN ('ready', 'no_positions')
     ORDER BY execution_date, lens_type, lens_key;
  `) as SnapshotRow[];
  if (!snapshotRows.length) return [];
  const ids = snapshotRows.map((row) => row.id);
  const holdingRows = (await sql`
    SELECT snapshot_id::text AS snapshot_id, rank, ticker,
           score::float8 AS score, weight::float8 AS weight, currency,
           source_report_ids::text[] AS source_report_ids,
           entry_date::text AS entry_date,
           entry_price_usd::float8 AS entry_price_usd
      FROM portfolio_holdings
     WHERE snapshot_id = ANY(${ids}::uuid[])
     ORDER BY snapshot_id, rank;
  `) as HoldingRow[];
  const bySnapshot = new Map<string, HoldingRow[]>();
  for (const holding of holdingRows) {
    if (!bySnapshot.has(holding.snapshot_id)) bySnapshot.set(holding.snapshot_id, []);
    bySnapshot.get(holding.snapshot_id)!.push(holding);
  }
  return snapshotRows.map((row) => ({
    id: row.id,
    track: row.track,
    lens: {
      type: row.lens_type,
      key: row.lens_type === "overall" ? null : row.lens_key,
      label: row.lens_label,
    },
    cutoffAt: new Date(row.cutoff_at).toISOString(),
    executionDate: row.execution_date,
    methodologyVersion: row.methodology_version,
    candidateCount: Number(row.candidate_count),
    status: row.status,
    holdings: (bySnapshot.get(row.id) || []).map((holding) => ({
      rank: Number(holding.rank),
      ticker: holding.ticker,
      score: Number(holding.score),
      weight: Number(holding.weight),
      currency: holding.currency,
      sourceReportIds: holding.source_report_ids || [],
      entryDate: holding.entry_date,
      entryPriceUsd: Number(holding.entry_price_usd),
    })),
  }));
}

export async function deletePortfolioTrack(
  track: PortfolioTrack,
  methodologyVersion: string,
): Promise<void> {
  if (track !== "backtest") throw new Error("Paper portfolio snapshots are immutable and cannot be deleted.");
  const sql = requireSql();
  await sql.transaction((tx) => [
    tx`
      DELETE FROM portfolio_nav_daily
       WHERE track = ${track} AND methodology_version = ${methodologyVersion};
    `,
    tx`
      DELETE FROM portfolio_snapshots
       WHERE track = ${track} AND methodology_version = ${methodologyVersion};
    `,
  ]);
}

export async function upsertPortfolioNav(args: {
  track: PortfolioTrack;
  lensType: "overall" | "model" | "valuator";
  lensKey: string;
  methodologyVersion: string;
  points: PortfolioNavPoint[];
}): Promise<void> {
  if (!args.points.length) return;
  const sql = requireSql();
  const chunkSize = 100;
  for (let index = 0; index < args.points.length; index += chunkSize) {
    const chunk = args.points.slice(index, index + chunkSize);
    await sql.transaction((tx) =>
      chunk.map((point) => tx`
        INSERT INTO portfolio_nav_daily (
          track, lens_type, lens_key, methodology_version, nav_date,
          snapshot_id, nav, benchmark_nav, holdings_count, status, updated_at
        ) VALUES (
          ${args.track}, ${args.lensType}, ${args.lensKey}, ${args.methodologyVersion},
          ${point.date}::date, ${point.snapshotId}::uuid, ${point.nav}, ${point.benchmarkNav},
          ${point.holdingsCount}, ${point.status}, now()
        )
        ON CONFLICT (track, lens_type, lens_key, methodology_version, nav_date) DO UPDATE SET
          snapshot_id = EXCLUDED.snapshot_id,
          nav = EXCLUDED.nav,
          benchmark_nav = EXCLUDED.benchmark_nav,
          holdings_count = EXCLUDED.holdings_count,
          status = EXCLUDED.status,
          updated_at = now();
      `),
    );
  }
}

export async function loadPortfolioNav(
  track: PortfolioTrack,
  methodologyVersion: string,
): Promise<StoredPortfolioNavPoint[]> {
  const sql = requireSql();
  const rows = (await sql`
    SELECT n.lens_type,
           n.lens_key,
           COALESCE(s.lens_label, n.lens_key) AS lens_label,
           n.methodology_version,
           n.nav_date::text AS nav_date,
           n.snapshot_id::text AS snapshot_id,
           n.nav::float8 AS nav,
           n.benchmark_nav::float8 AS benchmark_nav,
           n.holdings_count,
           n.status
      FROM portfolio_nav_daily n
      LEFT JOIN portfolio_snapshots s ON s.id = n.snapshot_id
     WHERE n.track = ${track}
       AND n.methodology_version = ${methodologyVersion}
     ORDER BY n.lens_type, n.lens_key, n.nav_date;
  `) as Array<{
    lens_type: "overall" | "model" | "valuator";
    lens_key: string;
    lens_label: string;
    methodology_version: string;
    nav_date: string;
    snapshot_id: string;
    nav: number;
    benchmark_nav: number;
    holdings_count: number;
    status: PortfolioNavPoint["status"];
  }>;
  return rows.map((row) => ({
    lensType: row.lens_type,
    lensKey: row.lens_key,
    lensLabel: row.lens_label,
    methodologyVersion: row.methodology_version,
    date: row.nav_date,
    snapshotId: row.snapshot_id,
    nav: Number(row.nav),
    benchmarkNav: Number(row.benchmark_nav),
    holdingsCount: Number(row.holdings_count),
    status: row.status,
  }));
}
