import "server-only";

import path from "node:path";
import { spawn } from "node:child_process";

import { repoRoot } from "@/lib/site-runner";

export async function startNasdaqWorker(runId: string): Promise<"remote" | "local"> {
  const workerUrl = String(process.env.NASDAQ_WORKER_URL || "").trim().replace(/\/+$/, "");
  if (workerUrl) {
    const token = String(process.env.NASDAQ_WORKER_TOKEN || "").trim();
    if (!token) throw new Error("NASDAQ_WORKER_TOKEN is required when NASDAQ_WORKER_URL is configured.");
    const response = await fetch(`${workerUrl}/wake`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ run_id: runId }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (!response.ok) throw new Error(payload.error || payload.message || `Worker wake failed (${response.status}).`);
    return "remote";
  }

  const root = repoRoot();
  const script = path.resolve(root, "scripts", "nasdaq_universe_run.py");
  const python = process.env.PYTHON_EXECUTABLE || "python";
  const child = spawn(python, [script, "--run-id", runId], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTHONPATH: path.resolve(root, "src"),
    },
  });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    child.once("spawn", () => {
      settled = true;
      child.unref();
      resolve();
    });
    child.once("error", (error) => {
      if (!settled) reject(error);
    });
  });
  return "local";
}
