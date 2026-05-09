import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hostnameFromRequestUrl, shouldBypassAuthForHostname } from "@/lib/auth-bypass";
import {
  appBootIso,
  reconcileStaleRunsAfterRestart,
  reconcileStaleRunsViaSql,
  TICKER_RE,
  type RunStatusPayload,
  repoRoot,
  runJobDir,
  runStatusFile,
  siteRunsRoot,
} from "@/lib/site-runner";
import { insertQueuedRun, updateRunStatusFromNode } from "@/lib/site-runs-db";
import { yahooValidate } from "@/lib/yahoo-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nowIso(): string {
  return new Date().toISOString();
}

function writeStatus(filePath: string, payload: RunStatusPayload): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

export async function POST(req: Request) {
  reconcileStaleRunsAfterRestart();
  // Fire-and-forget: SQL reconcile is best-effort and must not block the POST.
  void reconcileStaleRunsViaSql();

  const bypassAuth = shouldBypassAuthForHostname(hostnameFromRequestUrl(req.url));
  const session = await auth();
  const userId = session?.user?.id || (bypassAuth ? "local-dev" : "");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!bypassAuth && session?.user?.isGuest) {
    return NextResponse.json(
      {
        error: "Please sign in with Google before running a new analysis.",
        code: "SIGN_IN_REQUIRED",
      },
      { status: 403 },
    );
  }

  let body: { ticker?: string } = {};
  try {
    body = (await req.json()) as { ticker?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const ticker = String(body.ticker || "").trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }

  // Pre-flight: confirm Yahoo can resolve the ticker before spawning Python.
  // On Yahoo outage / timeout we proceed (preserves existing behavior so we
  // don't fully block runs when Yahoo is down — yfinance retries internally).
  const validation = await yahooValidate(ticker);
  if (!validation.ok) {
    const isTransient = validation.error.includes("timed out") || validation.error.includes("failed (");
    if (!isTransient) {
      return NextResponse.json({ error: validation.error }, { status: 422 });
    }
    console.warn(`[run-analysis] Yahoo validation transient failure for ${ticker}: ${validation.error}`);
  } else if (validation.instrumentType === "ETF") {
    return NextResponse.json(
      { error: `ETF analysis isn't supported yet (${ticker} is an ETF on ${validation.exchange}). Try a single-issuer equity.` },
      { status: 422 },
    );
  }

  const jobId = `${ticker}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const jobDir = runJobDir(jobId);
  const statusFile = runStatusFile(jobId);
  const progressFile = path.resolve(jobDir, "_progress.log");
  const startedAt = nowIso();

  const initialStatus: RunStatusPayload = {
    job_id: jobId,
    ticker,
    status: "queued",
    created_at: startedAt,
    started_at: null,
    finished_at: null,
    output_dir: jobDir,
    progress_file: progressFile,
    user_id: userId,
    attributed: false,
    runner_pid: null,
    worker_pid: null,
    llm_total_estimated: 30,
    llm_completed: 0,
    llm_progress_pct: 0,
    llm_calls_note: "Estimated total calls for one full valuation + dashboard extraction run.",
    result: null,
    report_id: null,
    persistence_error: "",
    error: "",
  };

  try {
    fs.mkdirSync(siteRunsRoot(), { recursive: true });
    fs.mkdirSync(jobDir, { recursive: true });
    writeStatus(statusFile, initialStatus);
  } catch {
    return NextResponse.json({ error: "Failed to initialize run directory." }, { status: 500 });
  }

  // Best-effort durable insert. The Python worker will UPSERT this row on its
  // first status write, so a Neon outage here doesn't lose the run.
  void insertQueuedRun({
    jobId,
    ticker,
    userId: userId,
    llmTotalEstimated: initialStatus.llm_total_estimated ?? 30,
    bootAnchorAt: appBootIso(),
  });

  const root = repoRoot();
  const scriptPath = path.resolve(root, "scripts", "site_run.py");
  const pythonExe = process.env.PYTHON_EXECUTABLE || "python";

  try {
    const child = spawn(
      pythonExe,
      [
        scriptPath,
        "--ticker",
        ticker,
        "--output-dir",
        jobDir,
        "--status-file",
        statusFile,
      ],
      {
        cwd: root,
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          PYTHONPATH: path.resolve(root, "src"),
        },
      },
    );
    const queuedStatus: RunStatusPayload = {
      ...initialStatus,
      runner_pid: typeof child.pid === "number" ? child.pid : null,
    };
    writeStatus(statusFile, queuedStatus);
    child.unref();
  } catch (err) {
    const failedStatus: RunStatusPayload = {
      ...initialStatus,
      status: "failed",
      started_at: startedAt,
      finished_at: nowIso(),
      report_id: null,
      persistence_error: "Run process failed to spawn.",
      error: `Failed to spawn process: ${String(err)}`,
    };
    writeStatus(statusFile, failedStatus);
    void updateRunStatusFromNode({
      jobId,
      status: "failed",
      finishedAt: failedStatus.finished_at,
      error: failedStatus.error || "",
    });
    return NextResponse.json({ error: "Failed to start analysis process." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    job_id: jobId,
    ticker,
    status: "queued",
  });
}
