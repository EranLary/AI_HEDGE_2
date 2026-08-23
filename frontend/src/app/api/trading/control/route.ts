import { NextResponse } from "next/server";

import { pauseTradingStrategy, resumeTradingStrategy } from "@/lib/trading-db";
import {
  requireTradingMutationEnabled,
  requireTradingUser,
  TradingDisabledError,
  TradingUnauthorizedError,
} from "@/lib/trading-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireTradingMutationEnabled();
    const user = await requireTradingUser();
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (!new Set(["pause", "resume", "kill_switch"]).has(action)) {
      return NextResponse.json({ error: "Invalid control action." }, { status: 400 });
    }
    const connectionId = String(body.connection_id || "");
    if (action === "resume") {
      await resumeTradingStrategy({ userId: user.userId, connectionId });
    } else {
      await pauseTradingStrategy({
        userId: user.userId,
        connectionId,
        cancelOpenOrders: action === "kill_switch",
      });
    }
    return NextResponse.json({ ok: true, action });
  } catch (error) {
    if (error instanceof TradingUnauthorizedError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TradingDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    const message = error instanceof Error ? error.message : "Could not apply the control action.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
