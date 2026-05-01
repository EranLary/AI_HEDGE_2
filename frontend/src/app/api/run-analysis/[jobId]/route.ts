import fs from "node:fs";

import { NextResponse } from "next/server";

import { attributeReportToUser, findReportIdBySourceRunId } from "@/lib/reports-db";
import {
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
  const { jobId } = await context.params;
  const cleanJobId = String(jobId || "").trim();
  if (!cleanJobId) {
    return NextResponse.json({ error: "Job id is required." }, { status: 400 });
  }

  const status = readRunStatus(cleanJobId);
  if (!status) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const updatedStatus = await reconcileCompletedStatus(status);

  const progress = readProgressLines(updatedStatus.progress_file || "", 80);
  const llmTotal = typeof updatedStatus.llm_total_estimated === "number" ? updatedStatus.llm_total_estimated : 0;
  const llmDone = typeof updatedStatus.llm_completed === "number" ? updatedStatus.llm_completed : 0;
  const llmPct =
    typeof updatedStatus.llm_progress_pct === "number"
      ? updatedStatus.llm_progress_pct
      : llmTotal > 0
        ? Math.min(100, Number(((llmDone / llmTotal) * 100).toFixed(2)))
        : 0;
  return NextResponse.json({
    ...updatedStatus,
    llm_total_estimated: llmTotal,
    llm_completed: llmDone,
    llm_progress_pct: llmPct,
    progress,
  });
}
