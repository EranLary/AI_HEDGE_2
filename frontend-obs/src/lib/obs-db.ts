import { unstable_cache } from "next/cache";
import { neon, NeonQueryFunction } from "@neondatabase/serverless";

// Short TTL on dashboard / runs-list aggregations: invisible to admins,
// but turns repeat dashboard hits from "5 sequential Neon HTTP fetches"
// into "served from the data cache". Revalidate via tag if a fresh-now
// button is ever needed.
const OBS_CACHE_TTL_S = 30;
const OBS_CACHE_TAGS = ["obs-data"];

let cached: NeonQueryFunction<false, false> | null = null;

export function getObsSql(): NeonQueryFunction<false, false> | null {
  if (cached) return cached;
  const url =
    process.env.OBS_DATABASE_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;
  if (!url) return null;
  cached = neon(url);
  return cached;
}

export function isObsDbEnabled(): boolean {
  return Boolean(
    process.env.OBS_DATABASE_URL ||
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.DATABASE_URL,
  );
}

export type ObsRunRow = {
  id: string;
  ticker: string;
  source: string;
  status: string;
  error_message: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  total_calls: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_usd: string;
};

export type ObsCallRow = {
  id: string;
  run_id: string;
  parent_id: string | null;
  sequence: number;
  stage: string;
  persona: string | null;
  call_site: string | null;
  model_requested: string;
  model_actual: string | null;
  temperature: string;
  prompt: string;
  response: string | null;
  reasoning: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_total: number | null;
  cost_usd: string | null;
  latency_ms: number;
  retries: number;
  status: string;
  error_class: string | null;
  error_message: string | null;
  started_at: string;
  ended_at: string;
};

// Slim row for list/DAG/hierarchy views: drops `response` and `reasoning`
// entirely (often multi-KB each) and ships only a 4 KB prefix of `prompt`
// (callTitle/derivePromptTitle/classifyPrompt all read at most ~4 KB).
// Full bodies are fetched on-demand via getCall() when a call panel opens.
export type ObsCallSummaryRow = Omit<ObsCallRow, "response" | "reasoning">;

async function _listRecentRuns(limit: number): Promise<ObsRunRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT id::text, ticker, source, status, error_message,
           started_at, ended_at, duration_ms,
           total_calls, total_tokens_in, total_tokens_out,
           total_cost_usd::text AS total_cost_usd
      FROM obs_runs
     ORDER BY started_at DESC
     LIMIT ${limit}
  `) as unknown as ObsRunRow[];
  return rows;
}

const _listRecentRunsCached = unstable_cache(
  _listRecentRuns,
  ["obs-list-recent-runs"],
  { revalidate: OBS_CACHE_TTL_S, tags: OBS_CACHE_TAGS },
);

export function listRecentRuns(limit = 50): Promise<ObsRunRow[]> {
  return _listRecentRunsCached(limit);
}

export async function getRun(runId: string): Promise<ObsRunRow | null> {
  const sql = getObsSql();
  if (!sql) return null;
  const rows = (await sql`
    SELECT id::text, ticker, source, status, error_message,
           started_at, ended_at, duration_ms,
           total_calls, total_tokens_in, total_tokens_out,
           total_cost_usd::text AS total_cost_usd
      FROM obs_runs
     WHERE id = ${runId}::uuid
  `) as unknown as ObsRunRow[];
  return rows[0] ?? null;
}

export async function listCallsForRun(runId: string): Promise<ObsCallSummaryRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT id::text, run_id::text, parent_id::text, sequence,
           stage, persona, call_site,
           model_requested, model_actual, temperature::text AS temperature,
           substr(prompt, 1, 4000) AS prompt,
           tokens_in, tokens_out, tokens_total,
           cost_usd::text AS cost_usd,
           latency_ms, retries, status, error_class, error_message,
           started_at, ended_at
      FROM obs_calls
     WHERE run_id = ${runId}::uuid
     ORDER BY sequence
  `) as unknown as ObsCallSummaryRow[];
  return rows;
}

export async function getCall(callId: string): Promise<ObsCallRow | null> {
  const sql = getObsSql();
  if (!sql) return null;
  const rows = (await sql`
    SELECT id::text, run_id::text, parent_id::text, sequence,
           stage, persona, call_site,
           model_requested, model_actual, temperature::text AS temperature,
           prompt, response, reasoning,
           tokens_in, tokens_out, tokens_total,
           cost_usd::text AS cost_usd,
           latency_ms, retries, status, error_class, error_message,
           started_at, ended_at
      FROM obs_calls
     WHERE id = ${callId}::uuid
  `) as unknown as ObsCallRow[];
  return rows[0] ?? null;
}

export type DashboardSummary = {
  run_count: number;
  success_count: number;
  error_count: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  total_cost_usd: string;
  total_tokens: number;
};

export type StageBreakdownRow = {
  stage: string;
  call_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_cost_usd: string;
  avg_cost_usd: string;
  error_count: number;
};

export type ModelBreakdownRow = {
  model: string;
  call_count: number;
  avg_latency_ms: number;
  total_cost_usd: string;
  avg_cost_usd: string;
};

export type DailySeriesRow = {
  day: string;
  run_count: number;
  cost_usd: string;
};

export type SpendBreakdownRow = {
  stage: string;
  label: string;
  call_count: number;
  cost_usd: string;
};

async function _getSpendBreakdown(days: number): Promise<SpendBreakdownRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT
      c.stage,
      coalesce(c.call_site, c.persona, 'unnamed') AS label,
      count(*)::int AS call_count,
      coalesce(sum(c.cost_usd), 0)::text AS cost_usd
      FROM obs_calls c
      JOIN obs_runs r ON r.id = c.run_id
     WHERE r.started_at >= now() - (${days}::int * interval '1 day')
       AND c.cost_usd IS NOT NULL
     GROUP BY c.stage, coalesce(c.call_site, c.persona, 'unnamed')
     HAVING sum(c.cost_usd) > 0
     ORDER BY sum(c.cost_usd) DESC
  `) as unknown as SpendBreakdownRow[];
  return rows;
}

const _getSpendBreakdownCached = unstable_cache(
  _getSpendBreakdown,
  ["obs-spend-breakdown"],
  { revalidate: OBS_CACHE_TTL_S, tags: OBS_CACHE_TAGS },
);

export function getSpendBreakdown(days: number): Promise<SpendBreakdownRow[]> {
  return _getSpendBreakdownCached(days);
}

async function _getDashboardSummary(days: number): Promise<DashboardSummary> {
  const sql = getObsSql();
  const empty: DashboardSummary = {
    run_count: 0,
    success_count: 0,
    error_count: 0,
    avg_duration_ms: 0,
    p50_duration_ms: 0,
    p95_duration_ms: 0,
    total_cost_usd: "0",
    total_tokens: 0,
  };
  if (!sql) return empty;
  const rows = (await sql`
    SELECT
      count(*)::int AS run_count,
      count(*) FILTER (WHERE status = 'success')::int AS success_count,
      count(*) FILTER (WHERE status = 'error')::int   AS error_count,
      coalesce(avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0)::int AS avg_duration_ms,
      coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p50_duration_ms,
      coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95_duration_ms,
      coalesce(sum(total_cost_usd), 0)::text AS total_cost_usd,
      coalesce(sum(total_tokens_in + total_tokens_out), 0)::int AS total_tokens
      FROM obs_runs
     WHERE started_at >= now() - (${days}::int * interval '1 day')
  `) as unknown as DashboardSummary[];
  return rows[0] ?? empty;
}

const _getDashboardSummaryCached = unstable_cache(
  _getDashboardSummary,
  ["obs-dashboard-summary"],
  { revalidate: OBS_CACHE_TTL_S, tags: OBS_CACHE_TAGS },
);

export function getDashboardSummary(days: number): Promise<DashboardSummary> {
  return _getDashboardSummaryCached(days);
}

async function _getStageBreakdown(days: number): Promise<StageBreakdownRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT
      c.stage,
      count(*)::int AS call_count,
      coalesce(avg(c.latency_ms), 0)::int AS avg_latency_ms,
      coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY c.latency_ms), 0)::int AS p95_latency_ms,
      coalesce(sum(c.cost_usd), 0)::text AS total_cost_usd,
      coalesce(avg(c.cost_usd), 0)::text AS avg_cost_usd,
      count(*) FILTER (WHERE c.status = 'error')::int AS error_count
      FROM obs_calls c
      JOIN obs_runs r ON r.id = c.run_id
     WHERE r.started_at >= now() - (${days}::int * interval '1 day')
     GROUP BY c.stage
     ORDER BY sum(c.cost_usd) DESC NULLS LAST
  `) as unknown as StageBreakdownRow[];
  return rows;
}

const _getStageBreakdownCached = unstable_cache(
  _getStageBreakdown,
  ["obs-stage-breakdown"],
  { revalidate: OBS_CACHE_TTL_S, tags: OBS_CACHE_TAGS },
);

export function getStageBreakdown(days: number): Promise<StageBreakdownRow[]> {
  return _getStageBreakdownCached(days);
}

async function _getModelBreakdown(days: number): Promise<ModelBreakdownRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT
      coalesce(c.model_actual, c.model_requested) AS model,
      count(*)::int AS call_count,
      coalesce(avg(c.latency_ms), 0)::int AS avg_latency_ms,
      coalesce(sum(c.cost_usd), 0)::text AS total_cost_usd,
      coalesce(avg(c.cost_usd), 0)::text AS avg_cost_usd
      FROM obs_calls c
      JOIN obs_runs r ON r.id = c.run_id
     WHERE r.started_at >= now() - (${days}::int * interval '1 day')
     GROUP BY coalesce(c.model_actual, c.model_requested)
     ORDER BY sum(c.cost_usd) DESC NULLS LAST
  `) as unknown as ModelBreakdownRow[];
  return rows;
}

const _getModelBreakdownCached = unstable_cache(
  _getModelBreakdown,
  ["obs-model-breakdown"],
  { revalidate: OBS_CACHE_TTL_S, tags: OBS_CACHE_TAGS },
);

export function getModelBreakdown(days: number): Promise<ModelBreakdownRow[]> {
  return _getModelBreakdownCached(days);
}

async function _getDailySeries(days: number): Promise<DailySeriesRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT
      to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
      count(*)::int AS run_count,
      coalesce(sum(total_cost_usd), 0)::text AS cost_usd
      FROM obs_runs
     WHERE started_at >= now() - (${days}::int * interval '1 day')
     GROUP BY 1
     ORDER BY 1
  `) as unknown as DailySeriesRow[];
  return rows;
}

const _getDailySeriesCached = unstable_cache(
  _getDailySeries,
  ["obs-daily-series"],
  { revalidate: OBS_CACHE_TTL_S, tags: OBS_CACHE_TAGS },
);

export function getDailySeries(days: number): Promise<DailySeriesRow[]> {
  return _getDailySeriesCached(days);
}

export async function listChildCalls(parentId: string): Promise<ObsCallSummaryRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
  const rows = (await sql`
    SELECT id::text, run_id::text, parent_id::text, sequence,
           stage, persona, call_site,
           model_requested, model_actual, temperature::text AS temperature,
           substr(prompt, 1, 4000) AS prompt,
           tokens_in, tokens_out, tokens_total,
           cost_usd::text AS cost_usd,
           latency_ms, retries, status, error_class, error_message,
           started_at, ended_at
      FROM obs_calls
     WHERE parent_id = ${parentId}::uuid
     ORDER BY sequence
  `) as unknown as ObsCallSummaryRow[];
  return rows;
}
