import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hostnameFromRequestUrl, shouldBypassAuthForHostname } from "@/lib/auth-bypass";
import { attributeReportToUser, findReportIdBySourceRunId } from "@/lib/reports-db";
import {
  reconcileStaleRunsAfterRestart,
  readProgressLines,
  readRunStatus,
  runStatusFile,
  type RunStatusPayload,
} from "@/lib/site-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function writeStatusSafe(status: RunStatusPayload): void {
  try {
    fs.writeFileSync(runStatusFile(status.job_id), JSON.stringify(status, null, 2), "utf-8");
  } catch {
    // best effort
  }
}

const PERSISTENCE_ONLY_ERROR_RE = /no reports row found for source_run_id/i;

function shouldTreatAsCompleted(status: RunStatusPayload): boolean {
  if (status.status !== "failed") return false;
  if (!PERSISTENCE_ONLY_ERROR_RE.test(String(status.persistence_error || status.error || ""))) return false;
  const result = status.result as Record<string, unknown> | null | undefined;
  return String(result?.status || "").toLowerCase() === "success";
}

function reconcileLegacyPersistenceFailure(status: RunStatusPayload): RunStatusPayload {
  if (!shouldTreatAsCompleted(status)) return status;
  const next: RunStatusPayload = {
    ...status,
    status: "completed",
    error: "",
  };
  writeStatusSafe(next);
  return next;
}

function progressPctFromPhaseLines(progressLines: string[]): number {
  if (!progressLines.length) return 0;
  const joined = progressLines.join("\n").toLowerCase();

  // Milestone fallback when LLM call counting cannot be observed.
  const steps = [
    { pattern: "finished analysis of files and financials", pct: 20 },
    { pattern: "finished analysis from sec filings", pct: 40 },
    { pattern: "finished dashboard extraction (pre-valuation)", pct: 60 },
    { pattern: "finished valuations", pct: 85 },
    { pattern: "finished technical analysis", pct: 97 },
  ];
  let pct = 0;
  for (const step of steps) {
    if (joined.includes(step.pattern)) pct = Math.max(pct, step.pct);
  }
  return pct;
}

function parsePid(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function isPidAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hasFile(filePath: string): boolean {
  if (!filePath) return false;
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function hasCompletionArtifacts(status: RunStatusPayload): boolean {
  const outputDir = String(status.output_dir || "").trim();
  const ticker = String(status.ticker || "").trim().toUpperCase();
  if (!outputDir || !ticker) return false;

  const dashboardJson = path.resolve(outputDir, `${ticker}_dashboard.json`);
  const analysisTxt = path.resolve(outputDir, `${ticker}_analysis.txt`);
  const analysisPdf = path.resolve(outputDir, `${ticker}_analysis.pdf`);

  return hasFile(dashboardJson) && (hasFile(analysisTxt) || hasFile(analysisPdf));
}

function shouldPromoteRunningToCompleted(status: RunStatusPayload, progressLines: string[]): boolean {
  if (status.status !== "running") return false;

  const workerAlive = isPidAlive(parsePid(status.worker_pid));
  const runnerAlive = isPidAlive(parsePid(status.runner_pid));
  if (workerAlive || runnerAlive) return false;

  if (!hasCompletionArtifacts(status)) return false;

  const joined = progressLines.join("\n").toLowerCase();
  const reachedFinalPhase =
    joined.includes("finished technical analysis") || joined.includes("finished valuations");
  const llmPct = typeof status.llm_progress_pct === "number" ? status.llm_progress_pct : 0;
  return reachedFinalPhase || llmPct >= 99;
}

function reconcileRunningCompletion(status: RunStatusPayload, progressLines: string[]): RunStatusPayload {
  if (!shouldPromoteRunningToCompleted(status, progressLines)) return status;

  const llmTotal = typeof status.llm_total_estimated === "number" ? status.llm_total_estimated : 0;
  const llmDone = typeof status.llm_completed === "number" ? status.llm_completed : 0;
  const next: RunStatusPayload = {
    ...status,
    status: "completed",
    finished_at: status.finished_at || new Date().toISOString(),
    error: "",
    llm_progress_pct: 100,
    llm_completed: Math.max(llmDone, llmTotal),
    result:
      status.result && typeof status.result === "object"
        ? status.result
        : { status: "success", source: "artifact_reconciliation" },
  };
  writeStatusSafe(next);
  return next;
}

function tryTerminatePid(pid: number): boolean {
  try {
    // Detached children usually run as their own process group on Linux.
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}

function cancelStatus(status: RunStatusPayload, message: string): RunStatusPayload {
  return {
    ...status,
    status: "failed",
    finished_at: new Date().toISOString(),
    error: message,
  };
}

async function hydrateReportIdIfMissing(status: RunStatusPayload): Promise<RunStatusPayload> {
  if (status.status !== "completed") return status;
  if (typeof status.report_id === "string" && status.report_id.trim()) return status;
  const reportId = await findReportIdBySourceRunId({
    jobId: status.job_id,
    ticker: status.ticker,
    source: "site",
  });
  if (!reportId) return status;
  const next: RunStatusPayload = { ...status, report_id: reportId };
  writeStatusSafe(next);
  return next;
}

async function attributeCompletedIfNeeded(status: RunStatusPayload): Promise<RunStatusPayload> {
  if (status.status !== "completed") return status;
  if (status.attributed) return status;
  if (!status.user_id || !UUID_RE.test(String(status.user_id))) return status;

  let ok = false;
  try {
    ok = await attributeReportToUser({
      ticker: status.ticker,
      jobId: status.job_id,
      userId: status.user_id,
    });
  } catch {
    ok = false;
  }
  if (!ok) return status;

  const next: RunStatusPayload = { ...status, attributed: true };
  writeStatusSafe(next);
  return next;
}

async function reconcileCompletedStatus(status: RunStatusPayload): Promise<RunStatusPayload> {
  if (status.status !== "completed") return status;
  const withReportId = await hydrateReportIdIfMissing(status);
  const withAttribution = await attributeCompletedIfNeeded(withReportId);
  return withAttribution;
}

export async function GET(
  _: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  reconcileStaleRunsAfterRestart();

  const { jobId } = await context.params;
  const cleanJobId = String(jobId || "").trim();
  if (!cleanJobId) {
    return NextResponse.json({ error: "Job id is required." }, { status: 400 });
  }

  const status = readRunStatus(cleanJobId);
  if (!status) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const reconciledStatus = reconcileLegacyPersistenceFailure(status);
  const progress = readProgressLines(reconciledStatus.progress_file || "", 80);
  const completionReconciled = reconcileRunningCompletion(reconciledStatus, progress);
  const updatedStatus = await reconcileCompletedStatus(completionReconciled);
  const llmTotal = typeof updatedStatus.llm_total_estimated === "number" ? updatedStatus.llm_total_estimated : 0;
  const llmDone = typeof updatedStatus.llm_completed === "number" ? updatedStatus.llm_completed : 0;
  let llmPct =
    typeof updatedStatus.llm_progress_pct === "number"
      ? updatedStatus.llm_progress_pct
      : llmTotal > 0
        ? Math.min(100, Number(((llmDone / llmTotal) * 100).toFixed(2)))
        : 0;

  if (llmPct <= 0 && updatedStatus.status === "running") {
    llmPct = progressPctFromPhaseLines(progress);
  }
  if (updatedStatus.status === "completed") {
    llmPct = Math.max(llmPct, 100);
  }
  llmPct = Math.max(0, Math.min(100, Number(llmPct.toFixed(2))));

  return NextResponse.json({
    ...updatedStatus,
    llm_total_estimated: llmTotal,
    llm_completed: llmDone,
    llm_progress_pct: llmPct,
    progress,
  });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  reconcileStaleRunsAfterRestart();

  const bypassAuth = shouldBypassAuthForHostname(hostnameFromRequestUrl(req.url));
  const session = await auth();
  const userId = session?.user?.id || (bypassAuth ? "local-dev" : "");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!bypassAuth && session?.user?.isGuest) {
    return NextResponse.json(
      {
        error: "Please sign in with Google before stopping a run.",
        code: "SIGN_IN_REQUIRED",
      },
      { status: 403 },
    );
  }

  const { jobId } = await context.params;
  const cleanJobId = String(jobId || "").trim();
  if (!cleanJobId) {
    return NextResponse.json({ error: "Job id is required." }, { status: 400 });
  }

  const status = readRunStatus(cleanJobId);
  if (!status) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  // Only the run owner can cancel unless local bypass is active.
  const statusUserId = String(status.user_id || "").trim();
  if (!bypassAuth && statusUserId && statusUserId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (status.status === "completed" || status.status === "failed") {
    return NextResponse.json({ ok: true, already_finished: true, status: status.status });
  }

  const pids = Array.from(
    new Set(
      [parsePid(status.worker_pid), parsePid(status.runner_pid)].filter(
        (pid): pid is number => typeof pid === "number" && pid > 0,
      ),
    ),
  );

  let killedAny = false;
  for (const pid of pids) {
    if (tryTerminatePid(pid)) {
      killedAny = true;
    }
  }

  const message = killedAny
    ? "Run canceled by user."
    : "Cancellation requested by user. Process termination could not be confirmed.";
  const canceled = cancelStatus(status, message);
  writeStatusSafe(canceled);

  return NextResponse.json({
    ok: true,
    status: canceled.status,
    killed: killedAny,
    message,
  });
}
