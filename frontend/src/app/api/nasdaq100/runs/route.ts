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
  requestNasdaqRunStop,
  type NasdaqRunMode,
} from "@/lib/nasdaq-runs-db";
import {
  enforceNasdaqExecutionWindow,
  isPreferredNasdaqExecutionWindow,
  NASDAQ_EXECUTION_WINDOW_LABEL,
} from "@/lib/nasdaq-execution-policy";
import { loadNasdaqUniverse } from "@/lib/nasdaq-universe";
import { startNasdaqWorker } from "@/lib/nasdaq-worker";

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
      executionWindow: {
        open: isPreferredNasdaqExecutionWindow(),
        enforced: enforceNasdaqExecutionWindow(),
        label: NASDAQ_EXECUTION_WINDOW_LABEL,
      },
    });
  } catch (error) {
    console.error("[nasdaq100/runs] GET failed:", error);
    return NextResponse.json({
      isAdmin: true,
      authorized: hasNasdaqRunAuthorization(request, admin.email),
      runs: [],
      error: "Universe-run storage is unavailable. Apply migrations through 009 before using RUN.",
    }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireNasdaqAdmin(request);
    if (!hasNasdaqRunAuthorization(request, admin.email)) {
      throw new NasdaqAdminError("Enter the run password again to continue.", 401);
    }
    if (enforceNasdaqExecutionWindow() && !isPreferredNasdaqExecutionWindow()) {
      throw new NasdaqRunConflictError(
        `Universe runs can start during the preferred off-peak window: ${NASDAQ_EXECUTION_WINDOW_LABEL}.`,
        422,
      );
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

    try {
      await startNasdaqWorker(created.run.id);
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

export async function DELETE(request: Request) {
  try {
    const admin = await requireNasdaqAdmin(request);
    if (!hasNasdaqRunAuthorization(request, admin.email)) {
      throw new NasdaqAdminError("Enter the run password again to continue.", 401);
    }
    const body = (await request.json()) as { runId?: unknown };
    const stopped = await requestNasdaqRunStop(String(body.runId || ""));
    if (!stopped) return NextResponse.json({ error: "No active universe run was found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof NasdaqAdminError || error instanceof NasdaqRunConflictError
      ? error.status
      : 500;
    const message = error instanceof Error ? error.message : "Failed to stop the universe run.";
    console.error("[nasdaq100/runs] DELETE failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
