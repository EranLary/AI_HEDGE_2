import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_VERSION = 3;

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
    let settled = false;
    const finish = (payload: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(payload);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ status: "error", rows: [], error: "Screener process timed out." });
    }, 75_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      finish({ status: "error", rows: [], error: err.message || "Screener process failed." });
    });
    child.on("close", () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        if (parsed.status !== "success" && stderr.trim() && !parsed.error) {
          parsed.error = stderr.trim();
        }
        finish(parsed);
      } catch {
        finish({ status: "error", rows: [], error: stderr.trim() || "Screener output was not valid JSON." });
      }
    });
  });
}

async function readLastGoodCache(): Promise<Record<string, unknown> | null> {
  try {
    const cachePath = path.resolve(repoRoot(), "outputs", "_screeners", "sp500_profiles.json");
    const parsed = JSON.parse(await fs.readFile(cachePath, "utf8")) as Record<string, unknown>;
    const rows = parsed.rows;
    if (parsed.status === "success" && parsed.cache_version === CACHE_VERSION && Array.isArray(rows) && rows.length) {
      return { ...parsed, cache_hit: true, stale_cache: true };
    }
  } catch {
    return null;
  }
  return null;
}

async function readBootstrapSeed(): Promise<Record<string, unknown> | null> {
  try {
    const seedPath = path.resolve(repoRoot(), "src", "ai_hedge", "static_data", "sp500_screener_scores_seed.json");
    const parsed = JSON.parse(await fs.readFile(seedPath, "utf8")) as Record<string, unknown>;
    const rows = parsed.rows;
    if (parsed.status === "success" && parsed.cache_version === CACHE_VERSION && Array.isArray(rows) && rows.length) {
      return { ...parsed, cache_hit: false, bootstrap_seed: true };
    }
  } catch {
    return null;
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = ["1", "true", "yes"].includes(String(url.searchParams.get("refresh") || "").toLowerCase());
  const payload = await runSp500Screener(refresh);
  if (payload.status !== "success") {
    const fallback = (await readLastGoodCache()) || (await readBootstrapSeed());
    if (fallback) {
      return NextResponse.json(fallback, { status: 200 });
    }
  }
  const status = payload.status === "success" ? 200 : 502;
  return NextResponse.json(payload, { status });
}
