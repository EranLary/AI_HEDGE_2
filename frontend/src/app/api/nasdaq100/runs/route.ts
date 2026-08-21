import path from "node:path";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import {
  hasNasdaqRunAuthorization,
  NasdaqAdminError,
  requireNasdaqAdmin,
  tryNasdaqAdmin,
} from "@/lib/nasdaq-admin";
import {
  createNasdaqRun,
  failNasdaqRunSpawn,
  listNasdaqRuns,
  NasdaqRunConflictError,
  reconcileStaleNasdaqRuns,
  type NasdaqRunMode,
} from "@/lib/nasdaq-runs-db";
import { loadNasdaqUniverse } from "@/lib/nasdaq-universe";
import { repoRoot } from "@/lib/site-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES = new Set<NasdaqRunMode>(["all", "selected", "missing_week"]);

export async function GET(request: Request) {
  const admin = await tryNasdaqAdmin(request);
  if (!admin) return NextResponse.json({ isAdmin: false, authorized: false, runs: [] });
  try {
    await reconcileStaleNasdaqRuns();
    const authorized = hasNasdaqRunAuthorization(request, admin.email);
    const [runs, universe] = await Promise.all([
      listNasdaqRuns(),
      authorized ? loadNasdaqUniverse() : Promise.resolve(null),
    ]);
    return NextResponse.json({
      isAdmin: true,
      authorized,
      runs,
      universe,
    });
  } catch (error) {
    console.error("[nasdaq100/runs] GET failed:", error);
    return NextResponse.json({
      isAdmin: true,
      authorized: hasNasdaqRunAuthorization(request, admin.email),
      runs: [],
      error: "Universe-run storage is unavailable. Apply migration 008 before using RUN.",
    }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireNasdaqAdmin(request);
    if (!hasNasdaqRunAuthorization(request, admin.email)) {
      throw new NasdaqAdminError("Enter the run password again to continue.", 401);
    }
    const body = (await request.json()) as { mode?: unknown; tickers?: unknown };
    const mode = String(body.mode || "") as NasdaqRunMode;
    if (!MODES.has(mode)) {
      return NextResponse.json({ error: "Choose a valid run mode." }, { status: 400 });
    }
    const selectedTickers = Array.isArray(body.tickers)
      ? body.tickers.map((ticker) => String(ticker || "").trim().toUpperCase()).filter(Boolean)
      : [];
    const universe = await loadNasdaqUniverse();
    const created = await createNasdaqRun({ admin, mode, selectedTickers, universe });

    const root = repoRoot();
    const script = path.resolve(root, "scripts", "nasdaq_universe_run.py");
    const python = process.env.PYTHON_EXECUTABLE || "python";
    try {
      const child = spawn(python, [script, "--run-id", created.run.id], {
        cwd: root,
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          PYTHONPATH: path.resolve(root, "src"),
        },
      });
      child.once("error", (error) => {
        void failNasdaqRunSpawn(created.run.id, `Universe runner process error: ${String(error)}`);
      });
      child.unref();
    } catch (error) {
      await failNasdaqRunSpawn(created.run.id, `Failed to spawn universe runner: ${String(error)}`);
      return NextResponse.json({ error: "Failed to start the universe process." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, resumed: created.resumed, run: created.run }, { status: 202 });
  } catch (error) {
    const status = error instanceof NasdaqAdminError || error instanceof NasdaqRunConflictError
      ? error.status
      : 500;
    const message = error instanceof Error ? error.message : "Failed to start the universe run.";
    console.error("[nasdaq100/runs] POST failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
