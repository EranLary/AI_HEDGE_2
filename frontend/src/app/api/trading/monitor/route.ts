import { NextResponse } from "next/server";

import { sendTradingTelegramAlert } from "@/lib/trading-alerts";
import { listPendingTradingAlerts, listStaleTradingConnections, recordTradingEvent } from "@/lib/trading-db";
import {
  constantTimeTextEqual,
  requireTradingMutationEnabled,
  TradingDisabledError,
} from "@/lib/trading-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireTradingMutationEnabled();
    const expected = String(process.env.TRADING_MONITOR_TOKEN || "").trim();
    const authorization = request.headers.get("authorization") || "";
    const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!expected || !constantTimeTextEqual(supplied, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const stale = await listStaleTradingConnections(10);
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
    let alerted = 0;
    for (const connection of stale) {
      const eventId = `heartbeat-stale:${bucket}`;
      const message = `${connection.mode.toUpperCase()} ${connection.accountMasked || "account"}: executor heartbeat is stale.`;
      const inserted = await recordTradingEvent({
        connectionId: connection.id,
        eventId,
        eventType: "heartbeat_stale",
        severity: "critical",
        message,
        payload: { last_heartbeat_at: connection.lastHeartbeatAt },
      });
      if (inserted) {
        await sendTradingTelegramAlert({ connectionId: connection.id, eventId, severity: "critical", message });
        alerted += 1;
      }
    }
    const pending = await listPendingTradingAlerts();
    let retried = 0;
    for (const alert of pending) {
      if (await sendTradingTelegramAlert(alert)) retried += 1;
    }
    return NextResponse.json({ checked: stale.length, alerted, pending: pending.length, delivered: retried });
  } catch (error) {
    if (error instanceof TradingDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("[trading] monitor failed", error);
    return NextResponse.json({ error: "Trading monitor failed." }, { status: 500 });
  }
}
