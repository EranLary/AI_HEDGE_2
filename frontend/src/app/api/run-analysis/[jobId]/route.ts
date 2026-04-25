import fs from "node:fs";

import { NextResponse } from "next/server";

import { attributeReportToUser } from "@/lib/reports-db";
import {
  readProgressLines,
  readRunStatus,
  runStatusFile,
  type RunStatusPayload,
} from "@/lib/site-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function attributeIfNeeded(status: RunStatusPayload): Promise<void> {
  if (status.status !== "completed") return;
  if (status.attributed) return;
  if (!status.user_id) return;
  const ok = await attributeReportToUser({
    ticker: status.ticker,
    jobId: status.job_id,
    userId: status.user_id,
  });
  if (!ok) return;
  try {
    const next: RunStatusPayload = { ...status, attributed: true };
    fs.writeFileSync(runStatusFile(status.job_id), JSON.stringify(next, null, 2), "utf-8");
  } catch {
    // best-effort flag write; the SQL guard makes the UPDATE itself idempotent
  }
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

  await attributeIfNeeded(status);

  const progress = readProgressLines(status.progress_file || "", 80);
  const llmTotal = typeof status.llm_total_estimated === "number" ? status.llm_total_estimated : 0;
  const llmDone = typeof status.llm_completed === "number" ? status.llm_completed : 0;
  const llmPct =
    typeof status.llm_progress_pct === "number"
      ? status.llm_progress_pct
      : llmTotal > 0
        ? Math.min(100, Number(((llmDone / llmTotal) * 100).toFixed(2)))
        : 0;
  return NextResponse.json({
    ...status,
    llm_total_estimated: llmTotal,
    llm_completed: llmDone,
    llm_progress_pct: llmPct,
    progress,
  });
}
