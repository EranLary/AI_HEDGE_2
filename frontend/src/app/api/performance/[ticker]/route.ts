import { NextResponse } from "next/server";
import path from "node:path";
import { spawn } from "node:child_process";

import { repoRoot } from "@/lib/site-runner";

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

type PerfResponse = {
  ticker: string;
  as_of?: string;
  returns_pct: {
    "1D"?: number | null;
    "1W"?: number | null;
    "1M"?: number | null;
    "3M"?: number | null;
    "6M"?: number | null;
    "1Y"?: number | null;
    "3Y"?: number | null;
    "5Y"?: number | null;
  };
};

function runLiveReturnsScript(ticker: string): Promise<PerfResponse> {
  return new Promise((resolve, reject) => {
    const root = repoRoot();
    const scriptPath = path.resolve(root, "scripts", "live_returns.py");
    const pythonExe = process.env.PYTHON_EXECUTABLE || "python";

    const child = spawn(pythonExe, [scriptPath, "--ticker", ticker], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: path.resolve(root, "src"),
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `live_returns.py exited with ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as PerfResponse;
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const tk = String(ticker || "").trim().toUpperCase();
  if (!TICKER_RE.test(tk)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }

  try {
    const result = await runLiveReturnsScript(tk);
    return NextResponse.json({
      ticker: tk,
      returns_pct: result?.returns_pct || {},
    } satisfies PerfResponse);
  } catch {
    return NextResponse.json({
      ticker: tk,
      returns_pct: {},
    } satisfies PerfResponse);
  }
}
