import { getSql } from "@/lib/db";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { listDashboardReports, readJson } from "@/lib/server-outputs";

export type ReportVisibility = "public" | "private" | "unlisted";

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
  visibility: ReportVisibility;
}

export interface DbReportFull extends DbReportSummary {
  dashboard_version: string;
  dashboard: unknown;
  analysis_md: string;
  prices_explain_md: string | null;
  analysis_md_source: "txt" | "html" | "pdf";
  r2_keys: Record<string, string> | null;
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
           r.visibility,
           a.dashboard,
           a.analysis_md,
           a.prices_explain_md,
           a.analysis_md_source,
           a.r2_keys
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
           r.visibility,
           a.dashboard,
           a.analysis_md,
           a.prices_explain_md,
           a.analysis_md_source,
           a.r2_keys
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
    SELECT DISTINCT ON (r.ticker)
           r.id::text AS id, r.ticker, r.generated_at,
           r.company_name,
           r.current_price::float8 AS current_price,
           r.market_cap::float8    AS market_cap,
           r.currency,
           COALESCE(NULLIF(r.recommendation, ''), a.dashboard->'decision_card'->>'action') AS recommendation,
           r.mean_target_price::float8 AS mean_target_price,
           r.source, r.source_run_id,
           r.visibility
      FROM reports r
      LEFT JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.deleted_at IS NULL
     ORDER BY r.ticker, r.generated_at DESC;
  `) as unknown as DbReportSummary[];
  return rows;
}

export async function attributeReportToUser(opts: {
  ticker: string;
  jobId: string;
  userId: string;
}): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const rows = (await sql`
    UPDATE reports
       SET user_id = ${opts.userId}::uuid
     WHERE ticker = ${opts.ticker}
       AND source = 'site'
       AND source_run_id = ${opts.jobId}
       AND user_id IS NULL
     RETURNING id;
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

function fallbackCommunityReportsFromOutputs(query?: string): DbReportSummary[] {
  const q = String(query || "").trim().toLowerCase();
  const rows: DbReportSummary[] = [];
  for (const entry of listDashboardReports()) {
    const dashboard = readJson<DashboardPayload>(entry.path);
    if (!dashboard) continue;
    const ticker = String(dashboard.ticker || entry.ticker || "").toUpperCase();
    if (!ticker) continue;
    const companyName = String(dashboard.header?.company_name || "").trim() || null;
    if (q) {
      const inTicker = ticker.toLowerCase().includes(q);
      const inCompany = String(companyName || "").toLowerCase().includes(q);
      if (!inTicker && !inCompany) continue;
    }
    const generatedAt =
      typeof dashboard.generated_at === "string" && dashboard.generated_at.trim()
        ? dashboard.generated_at
        : new Date(entry.mtimeMs).toISOString();
    rows.push({
      id: entry.report_id,
      ticker,
      generated_at: generatedAt,
      company_name: companyName,
      current_price:
        typeof dashboard.valuation_hub?.consensus?.current_price === "number" &&
        Number.isFinite(dashboard.valuation_hub.consensus.current_price)
          ? Number(dashboard.valuation_hub.consensus.current_price)
          : null,
      market_cap:
        typeof dashboard.header?.market_cap === "number" && Number.isFinite(dashboard.header.market_cap)
          ? Number(dashboard.header.market_cap)
          : null,
      currency: typeof dashboard.header?.currency === "string" ? dashboard.header.currency : null,
      recommendation:
        typeof dashboard.decision_card?.action === "string" && dashboard.decision_card.action.trim()
          ? dashboard.decision_card.action.trim()
          : null,
      mean_target_price:
        typeof dashboard.valuation_hub?.consensus?.mean_target_price === "number" &&
        Number.isFinite(dashboard.valuation_hub.consensus.mean_target_price)
          ? Number(dashboard.valuation_hub.consensus.mean_target_price)
          : null,
      source: "site",
      source_run_id: null,
      visibility: "public",
    });
  }
  rows.sort((a, b) => Date.parse(String(b.generated_at || "")) - Date.parse(String(a.generated_at || "")));
  return rows;
}

export async function findReportIdBySourceRunId(opts: {
  jobId: string;
  ticker?: string;
  source?: string;
}): Promise<string | null> {
  const sql = getSql();
  if (!sql) return null;
  const source = String(opts.source || "site");
  const ticker = String(opts.ticker || "").trim().toUpperCase();
  const rows = ticker
    ? ((await sql`
        SELECT id::text AS id
          FROM reports
         WHERE source = ${source}
           AND source_run_id = ${opts.jobId}
           AND ticker = ${ticker}
           AND deleted_at IS NULL
         ORDER BY generated_at DESC
         LIMIT 1;
      `) as Array<{ id: string }>)
    : ((await sql`
        SELECT id::text AS id
          FROM reports
         WHERE source = ${source}
           AND source_run_id = ${opts.jobId}
           AND deleted_at IS NULL
         ORDER BY generated_at DESC
         LIMIT 1;
      `) as Array<{ id: string }>);
  return rows[0]?.id || null;
}

/** Every report row, ordered by generated_at desc — for the /api/reports list. */
export async function listAllReports(): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT r.id::text AS id, r.ticker, r.generated_at,
           r.company_name,
           r.current_price::float8 AS current_price,
           r.market_cap::float8    AS market_cap,
           r.currency,
           COALESCE(NULLIF(r.recommendation, ''), a.dashboard->'decision_card'->>'action') AS recommendation,
           r.mean_target_price::float8 AS mean_target_price,
           r.source, r.source_run_id,
           r.visibility
      FROM reports r
      LEFT JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.deleted_at IS NULL
     ORDER BY r.generated_at DESC;
  `) as unknown as DbReportSummary[];
  return rows;
}

/** Reports owned by a specific user, regardless of visibility. */
export async function listUserReports(userId: string): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT r.id::text AS id, r.ticker, r.generated_at,
           r.company_name,
           r.current_price::float8 AS current_price,
           r.market_cap::float8    AS market_cap,
           r.currency,
           COALESCE(NULLIF(r.recommendation, ''), a.dashboard->'decision_card'->>'action') AS recommendation,
           r.mean_target_price::float8 AS mean_target_price,
           r.source, r.source_run_id,
           r.visibility
      FROM reports r
      LEFT JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.user_id = ${userId}::uuid
       AND r.deleted_at IS NULL
     ORDER BY r.generated_at DESC;
  `) as unknown as DbReportSummary[];
  return rows;
}

/** Public reports authored by anyone other than the optional excluded user. */
export async function listCommunityReports(excludeUserId?: string): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return fallbackCommunityReportsFromOutputs();
  try {
    const rows = excludeUserId
      ? ((await sql`
        SELECT r.id::text AS id, r.ticker, r.generated_at,
               r.company_name,
               r.current_price::float8 AS current_price,
               r.market_cap::float8    AS market_cap,
               r.currency,
               COALESCE(NULLIF(r.recommendation, ''), a.dashboard->'decision_card'->>'action') AS recommendation,
               r.mean_target_price::float8 AS mean_target_price,
               r.source, r.source_run_id,
               r.visibility
          FROM reports r
          LEFT JOIN report_artifacts a ON a.report_id = r.id
         WHERE r.visibility = 'public'
           AND r.deleted_at IS NULL
           AND (r.user_id IS NULL OR r.user_id <> ${excludeUserId}::uuid)
         ORDER BY r.generated_at DESC;
      `) as unknown as DbReportSummary[])
    : ((await sql`
        SELECT r.id::text AS id, r.ticker, r.generated_at,
               r.company_name,
               r.current_price::float8 AS current_price,
               r.market_cap::float8    AS market_cap,
               r.currency,
               COALESCE(NULLIF(r.recommendation, ''), a.dashboard->'decision_card'->>'action') AS recommendation,
               r.mean_target_price::float8 AS mean_target_price,
               r.source, r.source_run_id,
               r.visibility
          FROM reports r
          LEFT JOIN report_artifacts a ON a.report_id = r.id
          WHERE r.visibility = 'public'
            AND r.deleted_at IS NULL
         ORDER BY r.generated_at DESC;
      `) as unknown as DbReportSummary[]);
    return rows;
  } catch {
    return fallbackCommunityReportsFromOutputs();
  }
}

export interface PagedCommunityReports {
  rows: DbReportSummary[];
  hasMore: boolean;
}

/**
 * Paginated public reports. Filters by ticker/company name when `query` is set.
 * Returns `limit` rows plus a `hasMore` flag (computed by over-fetching one row).
 */
export async function listCommunityReportsPaged(opts: {
  excludeUserId?: string;
  query?: string;
  limit: number;
  offset: number;
}): Promise<PagedCommunityReports> {
  const rawLimit = Number(opts.limit);
  const rawOffset = Number(opts.offset);
  const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 16));
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);
  const sql = getSql();
  if (!sql) {
    const all = fallbackCommunityReportsFromOutputs(opts.query);
    const pageRows = all.slice(offset, offset + limit + 1);
    const hasMore = pageRows.length > limit;
    return { rows: hasMore ? pageRows.slice(0, limit) : pageRows, hasMore };
  }
  const fetchN = limit + 1;
  const q = String(opts.query || "").trim();
  const like = q ? `%${q}%` : "";
  const excludeUserId = opts.excludeUserId?.trim() || null;

  try {
    const rows = (excludeUserId
      ? ((await sql`
        SELECT r.id::text AS id, r.ticker, r.generated_at,
               r.company_name,
               r.current_price::float8 AS current_price,
               r.market_cap::float8    AS market_cap,
               r.currency,
               COALESCE(NULLIF(r.recommendation, ''), a.dashboard->'decision_card'->>'action') AS recommendation,
               r.mean_target_price::float8 AS mean_target_price,
               r.source, r.source_run_id,
               r.visibility
          FROM reports r
          LEFT JOIN report_artifacts a ON a.report_id = r.id
         WHERE r.visibility = 'public'
           AND r.deleted_at IS NULL
           AND (r.user_id IS NULL OR r.user_id <> ${excludeUserId}::uuid)
           AND (${like} = '' OR r.ticker ILIKE ${like} OR COALESCE(r.company_name, '') ILIKE ${like})
         ORDER BY r.generated_at DESC
         LIMIT ${fetchN}
        OFFSET ${offset};
      `) as unknown as DbReportSummary[])
    : ((await sql`
        SELECT r.id::text AS id, r.ticker, r.generated_at,
               r.company_name,
               r.current_price::float8 AS current_price,
               r.market_cap::float8    AS market_cap,
               r.currency,
               COALESCE(NULLIF(r.recommendation, ''), a.dashboard->'decision_card'->>'action') AS recommendation,
               r.mean_target_price::float8 AS mean_target_price,
               r.source, r.source_run_id,
               r.visibility
          FROM reports r
          LEFT JOIN report_artifacts a ON a.report_id = r.id
         WHERE r.visibility = 'public'
           AND r.deleted_at IS NULL
           AND (${like} = '' OR r.ticker ILIKE ${like} OR COALESCE(r.company_name, '') ILIKE ${like})
         ORDER BY r.generated_at DESC
         LIMIT ${fetchN}
        OFFSET ${offset};
      `) as unknown as DbReportSummary[]));

    const hasMore = rows.length > limit;
    return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
  } catch {
    const all = fallbackCommunityReportsFromOutputs(opts.query);
    const pageRows = all.slice(offset, offset + limit + 1);
    const hasMore = pageRows.length > limit;
    return { rows: hasMore ? pageRows.slice(0, limit) : pageRows, hasMore };
  }
}

/** Owner-scoped visibility update. Returns true if the row was updated. */
export async function setReportVisibility(opts: {
  reportId: string;
  userId: string;
  visibility: ReportVisibility;
}): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const rows = (await sql`
    UPDATE reports
       SET visibility = ${opts.visibility}
     WHERE id = ${opts.reportId}::uuid
       AND user_id = ${opts.userId}::uuid
       AND deleted_at IS NULL
     RETURNING id;
  `) as Array<{ id: string }>;
  return rows.length > 0;
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

/**
 * Full historical dashboard payloads (no DISTINCT) for site-level analytics
 * pages like Hit Rate.
 */
export async function listAllDashboardsForHitRate(): Promise<
  { ticker: string; generated_at: string; dashboard: unknown; source_run_id: string | null }[]
> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT r.ticker, r.generated_at, r.source_run_id, a.dashboard
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.deleted_at IS NULL
     ORDER BY r.generated_at DESC;
  `) as unknown as { ticker: string; generated_at: string; dashboard: unknown; source_run_id: string | null }[];
  return rows;
}

export async function listDashboardsForTicker(ticker: string): Promise<
  { ticker: string; generated_at: string; dashboard: unknown; source_run_id: string | null }[]
> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT r.ticker, r.generated_at, r.source_run_id, a.dashboard
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
     WHERE r.deleted_at IS NULL
       AND r.ticker = ${String(ticker || "").toUpperCase()}
     ORDER BY r.generated_at DESC;
  `) as unknown as { ticker: string; generated_at: string; dashboard: unknown; source_run_id: string | null }[];
  return rows;
}
