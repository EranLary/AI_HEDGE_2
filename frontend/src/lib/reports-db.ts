import { getSql } from "@/lib/db";

export interface DbReportSummary {
  id: string;
  ticker: string;
  generated_at: string;
  company_name: string | null;
  current_price: number | null;
  market_cap: number | null;
  currency: string | null;
  recommendation: string | null;
  mean_target_price: number | null;
  source: string;
  source_run_id: string | null;
}

export interface DbReportFull extends DbReportSummary {
  dashboard_version: string;
  dashboard: unknown;
  analysis_md: string;
  prices_explain_md: string | null;
  analysis_md_source: "txt" | "html" | "pdf";
}

export interface DbTickerRow {
  symbol: string;
  company_name: string | null;
  exchange: string | null;
  currency: string | null;
  report_count: number;
  last_analyzed_at: string | null;
}

export async function fetchLatestReport(ticker: string): Promise<DbReportFull | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = (await sql`
    SELECT r.id::text AS id,
           r.ticker,
           r.generated_at,
           r.dashboard_version,
           r.company_name,
           r.current_price::float8 AS current_price,
           r.market_cap::float8    AS market_cap,
           r.currency,
           r.recommendation,
           r.mean_target_price::float8 AS mean_target_price,
           r.source, r.source_run_id,
           a.dashboard,
           a.analysis_md,
           a.prices_explain_md,
           a.analysis_md_source
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.ticker = ${ticker.toUpperCase()}
       AND r.deleted_at IS NULL
     ORDER BY r.generated_at DESC
     LIMIT 1
  `) as unknown as DbReportFull[];
  return rows[0] || null;
}

export async function fetchReportById(id: string): Promise<DbReportFull | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = (await sql`
    SELECT r.id::text AS id,
           r.ticker,
           r.generated_at,
           r.dashboard_version,
           r.company_name,
           r.current_price::float8 AS current_price,
           r.market_cap::float8    AS market_cap,
           r.currency,
           r.recommendation,
           r.mean_target_price::float8 AS mean_target_price,
           r.source, r.source_run_id,
           a.dashboard,
           a.analysis_md,
           a.prices_explain_md,
           a.analysis_md_source
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.id = ${id}::uuid
       AND r.deleted_at IS NULL
     LIMIT 1
  `) as unknown as DbReportFull[];
  return rows[0] || null;
}

export async function listAllTickerSymbols(): Promise<string[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT symbol FROM tickers ORDER BY symbol;
  `) as unknown as { symbol: string }[];
  return rows.map((r) => r.symbol);
}

export async function listTickers(): Promise<DbTickerRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT symbol, company_name, exchange, currency, report_count,
           last_analyzed_at::text AS last_analyzed_at
      FROM tickers
     ORDER BY report_count DESC, symbol;
  `) as unknown as DbTickerRow[];
  return rows;
}

/**
 * Latest report per ticker — slim metadata, no JSON payload, no markdown.
 * The right query for any list page (homepage, discovery, recent reports).
 */
export async function listLatestReportsPerTicker(): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT DISTINCT ON (ticker)
           id::text AS id, ticker, generated_at,
           company_name,
           current_price::float8 AS current_price,
           market_cap::float8    AS market_cap,
           currency,
           recommendation,
           mean_target_price::float8 AS mean_target_price,
           source, source_run_id
      FROM reports
     WHERE deleted_at IS NULL
     ORDER BY ticker, generated_at DESC;
  `) as unknown as DbReportSummary[];
  return rows;
}

/** Every report row, ordered by generated_at desc — for the /api/reports list. */
export async function listAllReports(): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT id::text AS id, ticker, generated_at,
           company_name,
           current_price::float8 AS current_price,
           market_cap::float8    AS market_cap,
           currency,
           recommendation,
           mean_target_price::float8 AS mean_target_price,
           source, source_run_id
      FROM reports
     WHERE deleted_at IS NULL
     ORDER BY generated_at DESC;
  `) as unknown as DbReportSummary[];
  return rows;
}

/**
 * Fetches the dashboard payload for the discovery page — needs the JSON because
 * the existing discovery route reads consensus.cv / lmil from it. Could be
 * denormalized later if this becomes a hot path.
 */
export async function listDashboardsForDiscovery(): Promise<
  { ticker: string; generated_at: string; dashboard: unknown }[]
> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT DISTINCT ON (r.ticker)
           r.ticker, r.generated_at, a.dashboard
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.deleted_at IS NULL
     ORDER BY r.ticker, r.generated_at DESC;
  `) as unknown as { ticker: string; generated_at: string; dashboard: unknown }[];
  return rows;
}
