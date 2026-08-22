import { NextResponse } from "next/server";

import { sendTradingTelegramAlert } from "@/lib/trading-alerts";
import {
  loadExecutorCancellationIds,
  loadExecutorCommands,
  recordTradingEvent,
  updateTradingHeartbeat,
} from "@/lib/trading-db";
import { authenticateExecutorRequest, ExecutorAuthenticationError } from "@/lib/trading-executor-auth";
import {
  accountFingerprint,
  constantTimeTextEqual,
  requireTradingMutationEnabled,
  TradingDisabledError,
  sha256,
} from "@/lib/trading-security";

export const runtime = "nodejs";

type SyncBody = {
  account_id?: string;
  mode?: string;
  executor_version?: string;
  gateway_connected?: boolean;
  gateway_authenticated?: boolean;
  account_type?: string;
  error?: string;
  executor_instance_id?: string;
  lease_only?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    requireTradingMutationEnabled();
    const authenticated = await authenticateExecutorRequest<SyncBody>(request);
    const body = authenticated.body;
    const executorInstanceId = String(body.executor_instance_id || "");
    if (!UUID_RE.test(executorInstanceId)) {
      return NextResponse.json({ error: "A stable executor instance id is required." }, { status: 400 });
    }
    const suppliedFingerprint = accountFingerprint(String(body.account_id || ""));
    if (body.mode !== authenticated.mode
      || !constantTimeTextEqual(suppliedFingerprint, authenticated.accountFingerprint)) {
      return NextResponse.json({ error: "Executor account or mode does not match the paired connection." }, { status: 409 });
    }
    const leaseAcquired = await updateTradingHeartbeat({
      connectionId: authenticated.connectionId,
      executorInstanceId,
      gatewayConnected: body.gateway_connected === true,
      gatewayAuthenticated: body.gateway_authenticated === true,
      executorVersion: String(body.executor_version || "unknown").slice(0, 100),
      accountType: String(body.account_type || "UNKNOWN").slice(0, 100),
      error: String(body.error || "").slice(0, 2_000),
      leaseOnly: body.lease_only === true,
    });
    if (!leaseAcquired) {
      return NextResponse.json({ error: "Another executor instance owns the active lease." }, { status: 409 });
    }
    if (body.lease_only !== true && (!body.gateway_connected || !body.gateway_authenticated)) {
      const message = String(body.error || "IB Gateway is disconnected or unauthenticated.").slice(0, 2_000);
      const eventId = `gateway-disconnected:${new Date().toISOString().slice(0, 10)}:${sha256(message).slice(0, 12)}`;
      const inserted = await recordTradingEvent({
        connectionId: authenticated.connectionId,
        eventId,
        eventType: "gateway_disconnected",
        severity: "critical",
        message,
      });
      if (inserted) {
        await sendTradingTelegramAlert({
          connectionId: authenticated.connectionId,
          eventId,
          severity: "critical",
          message,
        });
      }
    }
    const commands = body.lease_only !== true && body.gateway_connected && body.gateway_authenticated
      ? await loadExecutorCommands(authenticated.connectionId, executorInstanceId)
      : [];
    const cancelRequestedPlanIds = await loadExecutorCancellationIds(
      authenticated.connectionId,
      executorInstanceId,
    );
    return NextResponse.json({
      server_time: new Date().toISOString(),
      commands,
      cancel_requested_plan_ids: cancelRequestedPlanIds,
    });
  } catch (error) {
    if (error instanceof ExecutorAuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TradingDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("[trading] executor sync failed", error);
    return NextResponse.json({ error: "Executor sync failed." }, { status: 500 });
  }
}
