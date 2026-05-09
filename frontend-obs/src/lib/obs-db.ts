import { neon, NeonQueryFunction } from "@neondatabase/serverless";

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

export async function listRecentRuns(limit = 50): Promise<ObsRunRow[]> {
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

export async function listCallsForRun(runId: string): Promise<ObsCallRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
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
     WHERE run_id = ${runId}::uuid
     ORDER BY sequence
  `) as unknown as ObsCallRow[];
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

export async function listChildCalls(parentId: string): Promise<ObsCallRow[]> {
  const sql = getObsSql();
  if (!sql) return [];
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
     WHERE parent_id = ${parentId}::uuid
     ORDER BY sequence
  `) as unknown as ObsCallRow[];
  return rows;
}
