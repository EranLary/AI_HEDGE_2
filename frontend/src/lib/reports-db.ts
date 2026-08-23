import { getSql } from "@/lib/db";
import type { DashboardPayload } from "@/lib/dashboard-types";
import { filterExcludedTickers, isExcludedTicker } from "@/lib/excluded-tickers";
import { listDashboardReports, readJson } from "@/lib/server-outputs";
import type { Workspace } from "@/lib/workspace";

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
  allocation_pct: number | null;
  score: number | null;
  source: string;
  source_run_id: string | null;
  visibility: ReportVisibility;
  workspace: Workspace;
  release_id: string | null;
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

export interface DeletedReportRef {
  id: string;
  ticker: string;
  source_run_id: string | null;
}

export async function fetchLatestReport(ticker: string, workspace: Workspace = "analysis"): Promise<DbReportFull | null> {
  if (isExcludedTicker(ticker)) return null;
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
           COALESCE(
             (a.dashboard->'score_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'decision_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'score_card'->>'mean_investment_amount')::float8 / 100000.0,
             (a.dashboard->'decision_card'->>'mean_investment_amount')::float8 / 100000.0
           ) AS allocation_pct,
           COALESCE(
             (a.dashboard->'score_card'->>'adjusted_score')::float8,
             (a.dashboard->'decision_card'->>'adjusted_score')::float8
           ) AS score,
           r.source, r.source_run_id,
           r.visibility, r.workspace, r.release_id::text AS release_id,
           a.dashboard,
           a.analysis_md,
           a.prices_explain_md,
           a.analysis_md_source,
           a.r2_keys
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.ticker = ${ticker.toUpperCase()}
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
       AND r.deleted_at IS NULL
     ORDER BY r.generated_at DESC
     LIMIT 1
  `) as unknown as DbReportFull[];
  return rows[0] || null;
}

export async function fetchReportById(id: string, workspace: Workspace = "analysis"): Promise<DbReportFull | null> {
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
           COALESCE(
             (a.dashboard->'score_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'decision_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'score_card'->>'mean_investment_amount')::float8 / 100000.0,
             (a.dashboard->'decision_card'->>'mean_investment_amount')::float8 / 100000.0
           ) AS allocation_pct,
           COALESCE(
             (a.dashboard->'score_card'->>'adjusted_score')::float8,
             (a.dashboard->'decision_card'->>'adjusted_score')::float8
           ) AS score,
           r.source, r.source_run_id,
           r.visibility, r.workspace, r.release_id::text AS release_id,
           a.dashboard,
           a.analysis_md,
           a.prices_explain_md,
           a.analysis_md_source,
           a.r2_keys
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.id = ${id}::uuid
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
       AND r.deleted_at IS NULL
     LIMIT 1
  `) as unknown as DbReportFull[];
  const row = rows[0] || null;
  return row && !isExcludedTicker(row.ticker) ? row : null;
}

export async function listAllTickerSymbols(workspace: Workspace = "analysis"): Promise<string[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT DISTINCT r.ticker AS symbol
      FROM reports r
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.deleted_at IS NULL
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY symbol;
  `) as unknown as { symbol: string }[];
  return filterExcludedTickers(rows.map((r) => r.symbol));
}

export async function listNasdaqReportTickersAvailableSince(since: Date): Promise<string[]> {
  if (!Number.isFinite(since.getTime())) throw new Error("A valid Nasdaq coverage start date is required.");
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT DISTINCT upper(r.ticker) AS ticker
      FROM reports r
     WHERE r.deleted_at IS NULL
       AND r.workspace = 'nasdaq100'
       AND r.available_at >= ${since.toISOString()}::timestamptz
     ORDER BY ticker;
  `) as unknown as Array<{ ticker: string }>;
  return filterExcludedTickers(rows.map((row) => row.ticker));
}

export async function listTickers(workspace: Workspace = "analysis"): Promise<DbTickerRow[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT t.symbol, t.company_name, t.exchange, t.currency,
           count(r.id)::int AS report_count,
           max(r.generated_at)::text AS last_analyzed_at
      FROM tickers t
      JOIN reports r ON r.ticker = t.symbol
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.deleted_at IS NULL
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     GROUP BY t.symbol, t.company_name, t.exchange, t.currency
     ORDER BY report_count DESC, t.symbol;
  `) as unknown as DbTickerRow[];
  return filterExcludedTickers(rows, (row) => row.symbol);
}

/**
 * Latest report per ticker — slim metadata, no JSON payload, no markdown.
 * The right query for any list page (homepage, discovery, recent reports).
 */
export async function listLatestReportsPerTicker(workspace: Workspace = "analysis"): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT DISTINCT ON (r.ticker)
           r.id::text AS id, r.ticker, r.generated_at,
           r.company_name,
           r.current_price::float8 AS current_price,
           r.market_cap::float8    AS market_cap,
           r.currency,
           NULLIF(r.recommendation, '') AS recommendation,
           r.mean_target_price::float8 AS mean_target_price,
           COALESCE(
             (a.dashboard->'score_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'decision_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'score_card'->>'mean_investment_amount')::float8 / 100000.0,
             (a.dashboard->'decision_card'->>'mean_investment_amount')::float8 / 100000.0
           ) AS allocation_pct,
           COALESCE(
             (a.dashboard->'score_card'->>'adjusted_score')::float8,
             (a.dashboard->'decision_card'->>'adjusted_score')::float8
           ) AS score,
           r.source, r.source_run_id,
           r.visibility, r.workspace, r.release_id::text AS release_id
      FROM reports r
      LEFT JOIN report_artifacts a ON a.report_id = r.id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.deleted_at IS NULL
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY r.ticker, r.generated_at DESC;
  `) as unknown as DbReportSummary[];
  return filterExcludedTickers(rows, (row) => row.ticker);
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
       AND workspace = 'analysis'
       AND user_id IS NULL
     RETURNING id;
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

type DeletedReportPredicate = (reportId: string, ticker: string, runId: string | null) => boolean;

function siteRunIdFromPathLike(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\\/g, "/");
  const match = normalized.match(/\/_site_runs\/([^/]+)/i);
  return match?.[1] ? String(match[1]).trim() : null;
}

async function deletedReportPredicate(workspace: Workspace): Promise<DeletedReportPredicate> {
  try {
    const refs = await listDeletedReportRefs(workspace);
    const ids = new Set<string>();
    const runKeys = new Set<string>();
    for (const ref of refs) {
      const id = String(ref.id || "").trim();
      const ticker = String(ref.ticker || "").trim().toUpperCase();
      const runId = String(ref.source_run_id || "").trim();
      if (id) ids.add(id);
      if (ticker && runId) runKeys.add(`${ticker}:${runId}`);
    }
    return (reportId, ticker, runId) =>
      ids.has(String(reportId || "").trim()) ||
      runKeys.has(`${String(ticker || "").trim().toUpperCase()}:${String(runId || "").trim()}`);
  } catch {
    return () => false;
  }
}

function fallbackCommunityReportsFromOutputs(
  workspace: Workspace,
  query?: string,
  isDeleted: DeletedReportPredicate = () => false,
): DbReportSummary[] {
  if (workspace === "nasdaq100") return [];
  const q = String(query || "").trim().toLowerCase();
  const rows: DbReportSummary[] = [];
  for (const entry of listDashboardReports()) {
    const dashboard = readJson<DashboardPayload>(entry.path);
    if (!dashboard) continue;
    if (dashboard.workspace === "nasdaq100") continue;
    const ticker = String(dashboard.ticker || entry.ticker || "").toUpperCase();
    if (!ticker) continue;
    if (isDeleted(entry.report_id, ticker, siteRunIdFromPathLike(entry.path))) continue;
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
      recommendation: null,
      mean_target_price:
        typeof dashboard.valuation_hub?.consensus?.mean_target_price === "number" &&
        Number.isFinite(dashboard.valuation_hub.consensus.mean_target_price)
          ? Number(dashboard.valuation_hub.consensus.mean_target_price)
          : null,
      allocation_pct:
        typeof (dashboard.score_card || dashboard.decision_card)?.position_size_pct_of_notional === "number" &&
        Number.isFinite((dashboard.score_card || dashboard.decision_card)?.position_size_pct_of_notional)
          ? Number((dashboard.score_card || dashboard.decision_card)?.position_size_pct_of_notional)
          : typeof (dashboard.score_card || dashboard.decision_card)?.mean_investment_amount === "number" &&
              Number.isFinite((dashboard.score_card || dashboard.decision_card)?.mean_investment_amount)
            ? Number((dashboard.score_card || dashboard.decision_card)?.mean_investment_amount) / 100000.0
            : null,
      score:
        typeof (dashboard.score_card || dashboard.decision_card)?.adjusted_score === "number" &&
        Number.isFinite((dashboard.score_card || dashboard.decision_card)?.adjusted_score)
          ? Number((dashboard.score_card || dashboard.decision_card)?.adjusted_score)
          : null,
      source: "site",
      source_run_id: null,
      visibility: "public",
      workspace: "analysis",
      release_id: null,
    });
  }
  rows.sort((a, b) => Date.parse(String(b.generated_at || "")) - Date.parse(String(a.generated_at || "")));
  return filterExcludedTickers(rows, (row) => row.ticker);
}

export async function findReportIdBySourceRunId(opts: {
  jobId: string;
  ticker?: string;
  source?: string;
  workspace?: Workspace;
}): Promise<string | null> {
  const sql = getSql();
  if (!sql) return null;
  const source = String(opts.source || "site");
  const ticker = String(opts.ticker || "").trim().toUpperCase();
  const workspace = opts.workspace || "analysis";
  if (isExcludedTicker(ticker)) return null;
  const rows = ticker
    ? ((await sql`
        SELECT id::text AS id
          FROM reports
         WHERE source = ${source}
           AND source_run_id = ${opts.jobId}
           AND ticker = ${ticker}
           AND workspace = ${workspace}
           AND deleted_at IS NULL
         ORDER BY generated_at DESC
         LIMIT 1;
      `) as Array<{ id: string }>)
    : ((await sql`
        SELECT id::text AS id
          FROM reports
         WHERE source = ${source}
           AND source_run_id = ${opts.jobId}
           AND workspace = ${workspace}
           AND deleted_at IS NULL
         ORDER BY generated_at DESC
         LIMIT 1;
      `) as Array<{ id: string }>);
  return rows[0]?.id || null;
}

/** Every report row, ordered by generated_at desc — for the /api/reports list. */
export async function listAllReports(workspace: Workspace = "analysis"): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT r.id::text AS id, r.ticker, r.generated_at,
           r.company_name,
           r.current_price::float8 AS current_price,
           r.market_cap::float8    AS market_cap,
           r.currency,
           NULLIF(r.recommendation, '') AS recommendation,
           r.mean_target_price::float8 AS mean_target_price,
           COALESCE(
             (a.dashboard->'score_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'decision_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'score_card'->>'mean_investment_amount')::float8 / 100000.0,
             (a.dashboard->'decision_card'->>'mean_investment_amount')::float8 / 100000.0
           ) AS allocation_pct,
           COALESCE(
             (a.dashboard->'score_card'->>'adjusted_score')::float8,
             (a.dashboard->'decision_card'->>'adjusted_score')::float8
           ) AS score,
           r.source, r.source_run_id,
           r.visibility, r.workspace, r.release_id::text AS release_id
      FROM reports r
      LEFT JOIN report_artifacts a ON a.report_id = r.id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.deleted_at IS NULL
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY r.generated_at DESC;
  `) as unknown as DbReportSummary[];
  return filterExcludedTickers(rows, (row) => row.ticker);
}

/** Reports owned by a specific user, regardless of visibility. */
export async function listUserReports(userId: string, workspace: Workspace = "analysis"): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT r.id::text AS id, r.ticker, r.generated_at,
           r.company_name,
           r.current_price::float8 AS current_price,
           r.market_cap::float8    AS market_cap,
           r.currency,
           NULLIF(r.recommendation, '') AS recommendation,
           r.mean_target_price::float8 AS mean_target_price,
           COALESCE(
             (a.dashboard->'score_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'decision_card'->>'position_size_pct_of_notional')::float8,
             (a.dashboard->'score_card'->>'mean_investment_amount')::float8 / 100000.0,
             (a.dashboard->'decision_card'->>'mean_investment_amount')::float8 / 100000.0
           ) AS allocation_pct,
           COALESCE(
             (a.dashboard->'score_card'->>'adjusted_score')::float8,
             (a.dashboard->'decision_card'->>'adjusted_score')::float8
           ) AS score,
           r.source, r.source_run_id,
           r.visibility, r.workspace, r.release_id::text AS release_id
      FROM reports r
      LEFT JOIN report_artifacts a ON a.report_id = r.id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.user_id = ${userId}::uuid
       AND r.deleted_at IS NULL
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY r.generated_at DESC;
  `) as unknown as DbReportSummary[];
  return filterExcludedTickers(rows, (row) => row.ticker);
}

/** Public reports authored by anyone. */
export async function listCommunityReports(workspace: Workspace = "analysis"): Promise<DbReportSummary[]> {
  const sql = getSql();
  if (!sql) return fallbackCommunityReportsFromOutputs(workspace);
  try {
    const rows = ((await sql`
        SELECT r.id::text AS id, r.ticker, r.generated_at,
               r.company_name,
               r.current_price::float8 AS current_price,
               r.market_cap::float8    AS market_cap,
               r.currency,
                NULLIF(r.recommendation, '') AS recommendation,
                r.mean_target_price::float8 AS mean_target_price,
                COALESCE(
                  (a.dashboard->'score_card'->>'position_size_pct_of_notional')::float8,
                  (a.dashboard->'decision_card'->>'position_size_pct_of_notional')::float8,
                  (a.dashboard->'score_card'->>'mean_investment_amount')::float8 / 100000.0,
                  (a.dashboard->'decision_card'->>'mean_investment_amount')::float8 / 100000.0
                ) AS allocation_pct,
                COALESCE(
                  (a.dashboard->'score_card'->>'adjusted_score')::float8,
                  (a.dashboard->'decision_card'->>'adjusted_score')::float8
                ) AS score,
               r.source, r.source_run_id,
               r.visibility, r.workspace, r.release_id::text AS release_id
          FROM reports r
          LEFT JOIN report_artifacts a ON a.report_id = r.id
          LEFT JOIN report_releases rel ON rel.id = r.release_id
         WHERE r.visibility = 'public'
           AND r.deleted_at IS NULL
           AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
         ORDER BY r.generated_at DESC;
      `) as unknown as DbReportSummary[]);
    return filterExcludedTickers(rows, (row) => row.ticker);
  } catch {
    return fallbackCommunityReportsFromOutputs(workspace, undefined, await deletedReportPredicate(workspace));
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
  query?: string;
  limit: number;
  offset: number;
  workspace?: Workspace;
}): Promise<PagedCommunityReports> {
  const rawLimit = Number(opts.limit);
  const rawOffset = Number(opts.offset);
  const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 16));
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);
  const workspace = opts.workspace || "analysis";
  const sql = getSql();
  if (!sql) {
    const all = fallbackCommunityReportsFromOutputs(workspace, opts.query);
    const pageRows = all.slice(offset, offset + limit + 1);
    const hasMore = pageRows.length > limit;
    return { rows: hasMore ? pageRows.slice(0, limit) : pageRows, hasMore };
  }
  const fetchN = limit + 1;
  const q = String(opts.query || "").trim();
  const like = q ? `%${q}%` : "";

  try {
    const rows = ((await sql`
        SELECT r.id::text AS id, r.ticker, r.generated_at,
               r.company_name,
               r.current_price::float8 AS current_price,
               r.market_cap::float8    AS market_cap,
               r.currency,
                NULLIF(r.recommendation, '') AS recommendation,
                r.mean_target_price::float8 AS mean_target_price,
                COALESCE(
                  (a.dashboard->'score_card'->>'position_size_pct_of_notional')::float8,
                  (a.dashboard->'decision_card'->>'position_size_pct_of_notional')::float8,
                  (a.dashboard->'score_card'->>'mean_investment_amount')::float8 / 100000.0,
                  (a.dashboard->'decision_card'->>'mean_investment_amount')::float8 / 100000.0
                ) AS allocation_pct,
                COALESCE(
                  (a.dashboard->'score_card'->>'adjusted_score')::float8,
                  (a.dashboard->'decision_card'->>'adjusted_score')::float8
                ) AS score,
               r.source, r.source_run_id,
               r.visibility, r.workspace, r.release_id::text AS release_id
          FROM reports r
          LEFT JOIN report_artifacts a ON a.report_id = r.id
          LEFT JOIN report_releases rel ON rel.id = r.release_id
         WHERE r.visibility = 'public'
           AND r.deleted_at IS NULL
           AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
           AND (${like} = '' OR r.ticker ILIKE ${like} OR COALESCE(r.company_name, '') ILIKE ${like})
         ORDER BY r.generated_at DESC
         LIMIT ${fetchN}
        OFFSET ${offset};
      `) as unknown as DbReportSummary[]);

    const filteredRows = filterExcludedTickers(rows, (row) => row.ticker);
    const hasMore = filteredRows.length > limit;
    return { rows: hasMore ? filteredRows.slice(0, limit) : filteredRows, hasMore };
  } catch {
    const all = fallbackCommunityReportsFromOutputs(workspace, opts.query, await deletedReportPredicate(workspace));
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
  workspace?: Workspace;
}): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const rows = (await sql`
    UPDATE reports
       SET visibility = ${opts.visibility}
     WHERE id = ${opts.reportId}::uuid
       AND user_id = ${opts.userId}::uuid
       AND workspace = ${opts.workspace || "analysis"}
       AND deleted_at IS NULL
     RETURNING id;
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

/** Owner-scoped soft delete. Deleted reports are excluded from lists and aggregate calculations. */
export async function deleteUserReport(opts: {
  reportId: string;
  userId: string;
  workspace?: Workspace;
}): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const rows = (await sql`
    UPDATE reports
       SET deleted_at = now()
     WHERE id = ${opts.reportId}::uuid
       AND user_id = ${opts.userId}::uuid
       AND workspace = ${opts.workspace || "analysis"}
       AND deleted_at IS NULL
     RETURNING id;
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function listDeletedReportRefs(workspace: Workspace = "analysis"): Promise<DeletedReportRef[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT id::text AS id,
           ticker,
           source_run_id
      FROM reports
     WHERE deleted_at IS NOT NULL
       AND workspace = ${workspace};
  `) as unknown as DeletedReportRef[];
  return filterExcludedTickers(rows, (row) => row.ticker);
}

export async function listDeletedReportRefsForTicker(
  ticker: string,
  workspace: Workspace = "analysis",
): Promise<DeletedReportRef[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT id::text AS id,
           ticker,
           source_run_id
      FROM reports
     WHERE deleted_at IS NOT NULL
       AND ticker = ${String(ticker || "").toUpperCase()}
       AND workspace = ${workspace};
  `) as unknown as DeletedReportRef[];
  return filterExcludedTickers(rows, (row) => row.ticker);
}

/**
 * Fetches the dashboard payload for the discovery page — needs the JSON because
 * the existing discovery route reads consensus.cv / lmil from it. Could be
 * denormalized later if this becomes a hot path.
 */
export async function listDashboardsForDiscovery(workspace: Workspace = "analysis"): Promise<
  { ticker: string; generated_at: string; dashboard: unknown }[]
> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT DISTINCT ON (r.ticker)
           r.ticker, r.generated_at, a.dashboard
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.deleted_at IS NULL
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY r.ticker, r.generated_at DESC;
  `) as unknown as { ticker: string; generated_at: string; dashboard: unknown }[];
  return filterExcludedTickers(rows, (row) => row.ticker);
}

/**
 * Full historical dashboard payloads (no DISTINCT) for site-level analytics
 * pages like Hit Rate.
 */
export async function listAllDashboardsForHitRate(workspace: Workspace = "analysis"): Promise<
  { id: string; ticker: string; generated_at: string; available_at: string; dashboard: unknown; source_run_id: string | null }[]
> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT r.id::text AS id, r.ticker, r.generated_at,
           r.available_at,
           r.source_run_id, a.dashboard
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.deleted_at IS NULL
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY r.generated_at DESC;
  `) as unknown as { id: string; ticker: string; generated_at: string; available_at: string; dashboard: unknown; source_run_id: string | null }[];
  return filterExcludedTickers(rows, (row) => row.ticker);
}

export async function listDashboardsForTicker(ticker: string, workspace: Workspace = "analysis"): Promise<
  { ticker: string; generated_at: string; dashboard: unknown; source_run_id: string | null }[]
> {
  const sql = getSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT r.ticker, r.generated_at, r.source_run_id, a.dashboard
      FROM reports r
      JOIN report_artifacts a ON a.report_id = r.id
      LEFT JOIN report_releases rel ON rel.id = r.release_id
     WHERE r.deleted_at IS NULL
       AND r.ticker = ${String(ticker || "").toUpperCase()}
       AND r.workspace = ${workspace}
       AND (${workspace} = 'analysis' OR rel.status IN ('running', 'active'))
     ORDER BY r.generated_at DESC;
  `) as unknown as { ticker: string; generated_at: string; dashboard: unknown; source_run_id: string | null }[];
  return filterExcludedTickers(rows, (row) => row.ticker);
}
