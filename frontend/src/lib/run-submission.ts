"use client";

import { upsertActiveRun, type ClientRunStatus } from "@/lib/active-runs";
import { nudgeActiveRuns } from "@/components/shell/active-runs-store";

export const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

export type SubmitNewRunResult = {
  job_id: string;
  ticker: string;
  status: ClientRunStatus;
};

export class InvalidTickerError extends Error {
  constructor(ticker: string) {
    super(`"${ticker}" is not a valid ticker. Use letters/numbers up to 10 chars.`);
    this.name = "InvalidTickerError";
  }
}

export class TickerNotFoundError extends Error {
  constructor(ticker: string, detail?: string) {
    super(detail || `Ticker '${ticker}' not found on Yahoo Finance.`);
    this.name = "TickerNotFoundError";
  }
}

export class SignInRequiredForRunError extends Error {
  constructor(detail?: string) {
    super(detail || "Please sign in with Google before running a new analysis.");
    this.name = "SignInRequiredForRunError";
  }
}

/** Single source of truth for starting an analysis run. Validates the ticker,
 *  POSTs to /api/run-analysis, seeds the active-runs store, and returns the
 *  job_id so callers can do per-call follow-up if needed. */
export async function submitNewRun(rawTicker: string): Promise<SubmitNewRunResult> {
  const ticker = String(rawTicker || "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    throw new InvalidTickerError(ticker);
  }

  const res = await fetch("/api/run-analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  const json = (await res.json().catch(() => ({}))) as { job_id?: string; error?: string; status?: string };
  if (res.status === 422) {
    throw new TickerNotFoundError(ticker, json.error);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SignInRequiredForRunError(json.error);
  }
  if (!res.ok || !json.job_id) {
    throw new Error(json.error || `Failed to start analysis (${res.status}).`);
  }

  const status = (json.status as ClientRunStatus) || "queued";
  upsertActiveRun({
    job_id: json.job_id,
    ticker,
    status,
    llm_progress_pct: 0,
    created_at: new Date().toISOString(),
  });
  nudgeActiveRuns();

  return { job_id: json.job_id, ticker, status };
}
