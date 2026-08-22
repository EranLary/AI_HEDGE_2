import { NextResponse } from "next/server";

import { sendTradingTelegramAlert } from "@/lib/trading-alerts";
import {
  insertTradingFill,
  recordTradingEvent,
  replaceTradingStrategyPositions,
  updateRebalanceStatus,
  upsertTradingInstrument,
  upsertTradingOrder,
} from "@/lib/trading-db";
import { authenticateExecutorRequest, ExecutorAuthenticationError } from "@/lib/trading-executor-auth";
import { requireTradingMutationEnabled, TradingDisabledError } from "@/lib/trading-security";
import type { RebalanceStatus } from "@/lib/trading-types";

export const runtime = "nodejs";

const PLAN_STATUSES = new Set<RebalanceStatus>([
  "queued", "preflight", "awaiting_market", "selling", "buying", "completed",
  "partial", "blocked", "cancel_requested", "cancelled",
]);
const ORDER_STATUSES = new Set([
  "planned", "what_if", "submitted", "partially_filled", "filled",
  "cancel_pending", "cancelled", "rejected", "error",
]);

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request) {
  try {
    requireTradingMutationEnabled();
    const { connectionId, body } = await authenticateExecutorRequest<Record<string, unknown>>(request);
    const action = String(body.action || "");
    let accepted = false;
    let responsePayload: Record<string, unknown> = {};
    if (action === "plan_status") {
      const status = String(body.status || "") as RebalanceStatus;
      if (!PLAN_STATUSES.has(status)) return NextResponse.json({ error: "Invalid plan status." }, { status: 400 });
      accepted = await updateRebalanceStatus({
        connectionId,
        planId: String(body.plan_id || ""),
        status,
        error: String(body.error || "").slice(0, 2_000),
        preflight: (body.preflight || {}) as Record<string, unknown>,
      });
    } else if (action === "instrument") {
      const conid = finite(body.conid);
      const symbol = String(body.symbol || "");
      if (!conid || !symbol || symbol.length > 30) return NextResponse.json({ error: "Invalid instrument." }, { status: 400 });
      await upsertTradingInstrument({
        symbol, conid,
        secType: String(body.sec_type || "STK"), exchange: String(body.exchange || "SMART"),
        primaryExchange: String(body.primary_exchange || ""), currency: String(body.currency || "USD"),
        minTick: finite(body.min_tick), minSize: finite(body.min_size), sizeIncrement: finite(body.size_increment),
        supportsFractional: body.supports_fractional === true,
        liquidHours: String(body.liquid_hours || ""), timeZone: String(body.time_zone || ""),
        approved: body.approved === true,
      });
      accepted = true;
    } else if (action === "order") {
      const side = String(body.side || "");
      const status = String(body.status || "");
      const quantity = finite(body.requested_quantity);
      const clientOrderKey = String(body.client_order_key || "");
      const symbol = String(body.symbol || "");
      if ((side !== "BUY" && side !== "SELL") || !ORDER_STATUSES.has(status) || !quantity || quantity <= 0
        || !clientOrderKey || clientOrderKey.length > 300 || !symbol || symbol.length > 30) {
        return NextResponse.json({ error: "Invalid order event." }, { status: 400 });
      }
      const orderId = await upsertTradingOrder({
        connectionId, planId: String(body.plan_id || ""), clientOrderKey,
        symbol, conid: finite(body.conid), side,
        requestedQuantity: quantity, limitPrice: finite(body.limit_price), ibOrderId: finite(body.ib_order_id),
        ibPermId: finite(body.ib_perm_id), status, filledQuantity: finite(body.filled_quantity) || 0,
        averageFillPrice: finite(body.average_fill_price), commission: finite(body.commission) || 0,
        commissionCurrency: String(body.commission_currency || "USD"),
        rawStatus: (body.raw_status || {}) as Record<string, unknown>,
      });
      accepted = Boolean(orderId);
      responsePayload = { order_id: orderId };
    } else if (action === "fill") {
      const side = String(body.side || "");
      const quantity = finite(body.quantity);
      const price = finite(body.price);
      const execId = String(body.exec_id || "");
      const symbol = String(body.symbol || "");
      if ((side !== "BUY" && side !== "SELL") || !quantity || quantity <= 0 || !price || price <= 0
        || !execId || execId.length > 300 || !symbol || symbol.length > 30) {
        return NextResponse.json({ error: "Invalid fill event." }, { status: 400 });
      }
      accepted = await insertTradingFill({
        connectionId, orderId: body.order_id ? String(body.order_id) : null,
        execId, symbol, side,
        quantity, price, commission: finite(body.commission) || 0,
        commissionCurrency: String(body.commission_currency || "USD"),
        executedAt: String(body.executed_at || new Date().toISOString()),
        rawExecution: (body.raw_execution || {}) as Record<string, unknown>,
      });
    } else if (action === "positions") {
      const positions = Array.isArray(body.positions) ? body.positions : [];
      accepted = await replaceTradingStrategyPositions({
        connectionId,
        strategyLinkId: String(body.strategy_link_id || ""),
        positions: positions.map((value) => {
          const row = (value || {}) as Record<string, unknown>;
          return {
            symbol: String(row.symbol || ""), conid: finite(row.conid), quantity: finite(row.quantity) ?? -1,
            averageCostUsd: finite(row.average_cost_usd),
          };
        }),
      });
    } else if (action === "event") {
      const severity = String(body.severity || "info") as "info" | "warning" | "critical";
      if (!new Set(["info", "warning", "critical"]).has(severity)) {
        return NextResponse.json({ error: "Invalid event severity." }, { status: 400 });
      }
      const eventId = String(body.event_id || "");
      const message = String(body.message || "").slice(0, 2_000);
      if (!eventId || eventId.length > 300) return NextResponse.json({ error: "Invalid event id." }, { status: 400 });
      accepted = await recordTradingEvent({
        connectionId, eventId, eventType: String(body.event_type || "executor"), severity, message,
        payload: (body.payload || {}) as Record<string, unknown>,
      });
      if (accepted && severity !== "info") {
        await sendTradingTelegramAlert({ connectionId, eventId, severity, message });
      }
    } else {
      return NextResponse.json({ error: "Unknown executor event action." }, { status: 400 });
    }
    return NextResponse.json({ accepted, ...responsePayload });
  } catch (error) {
    if (error instanceof ExecutorAuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TradingDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("[trading] executor event failed", error);
    return NextResponse.json({ error: "Executor event failed." }, { status: 500 });
  }
}
