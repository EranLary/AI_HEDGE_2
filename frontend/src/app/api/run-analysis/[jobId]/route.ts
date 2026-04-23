import { NextResponse } from "next/server";

import { readProgressLines, readRunStatus } from "@/lib/site-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
