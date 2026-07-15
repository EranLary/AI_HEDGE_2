import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

function runSp500Screener(refresh: boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const root = repoRoot();
    const scriptPath = path.resolve(root, "scripts", "screener_sp500_profiles.py");
    const pythonExe = process.env.PYTHON_EXECUTABLE || "python";
    const args = [scriptPath, "--cache-minutes", "720", "--workers", "6"];
    if (refresh) args.push("--refresh");

    const child = spawn(pythonExe, args, {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: path.resolve(root, "src"),
      },
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
    }, 180_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ status: "error", rows: [], error: err.message || "Screener process failed." });
    });
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        if (parsed.status !== "success" && stderr.trim() && !parsed.error) {
          parsed.error = stderr.trim();
        }
        resolve(parsed);
      } catch {
        resolve({ status: "error", rows: [], error: stderr.trim() || "Screener output was not valid JSON." });
      }
    });
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
  const payload = await runSp500Screener(refresh);
  const status = payload.status === "success" ? 200 : 502;
  return NextResponse.json(payload, { status });
}
