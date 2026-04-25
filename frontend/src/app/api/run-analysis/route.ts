import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hostnameFromRequestUrl, shouldBypassAuthForHostname } from "@/lib/auth-bypass";
import {
  TICKER_RE,
  type RunStatusPayload,
  repoRoot,
  runJobDir,
  runStatusFile,
  siteRunsRoot,
} from "@/lib/site-runner";

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
  const bypassAuth = shouldBypassAuthForHostname(hostnameFromRequestUrl(req.url));
  const session = await auth();
  const userId = session?.user?.id || (bypassAuth ? "local-dev" : "");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const jobId = `${ticker}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const jobDir = runJobDir(jobId);
  const statusFile = runStatusFile(jobId);
  const progressFile = path.resolve(jobDir, ticker, "_progress.log");
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
    llm_total_estimated: 30,
    llm_completed: 0,
    llm_progress_pct: 0,
    llm_calls_note: "Estimated total calls for one full valuation + dashboard extraction run.",
    result: null,
    error: "",
  };

  try {
    fs.mkdirSync(siteRunsRoot(), { recursive: true });
    fs.mkdirSync(jobDir, { recursive: true });
    writeStatus(statusFile, initialStatus);
  } catch {
    return NextResponse.json({ error: "Failed to initialize run directory." }, { status: 500 });
  }

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
    child.unref();
  } catch (err) {
    const failedStatus: RunStatusPayload = {
      ...initialStatus,
      status: "failed",
      started_at: startedAt,
      finished_at: nowIso(),
      error: `Failed to spawn process: ${String(err)}`,
    };
    writeStatus(statusFile, failedStatus);
    return NextResponse.json({ error: "Failed to start analysis process." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    job_id: jobId,
    ticker,
    status: "queued",
  });
}
