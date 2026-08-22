import { NextResponse } from "next/server";

import { sendTradingTelegramAlert } from "@/lib/trading-alerts";
import {
  configureTradingStrategy,
  consumeTradingStrategyPreview,
  createTradingStrategyPreview,
  recordTradingEvent,
} from "@/lib/trading-db";
import {
  requireTradingMutationEnabled,
  requireTradingUser,
  TradingDisabledError,
  TradingUnauthorizedError,
} from "@/lib/trading-security";
import type { TradingLensType } from "@/lib/trading-types";
import { isWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const LENSES = new Set<TradingLensType>(["overall", "model", "valuator"]);

export async function POST(request: Request) {
  try {
    requireTradingMutationEnabled();
    const user = await requireTradingUser();
    const body = await request.json() as Record<string, unknown>;
    const previewId = String(body.preview_id || "");
    if (previewId) {
      if (!UUID_RE.test(previewId)) return NextResponse.json({ error: "Invalid preview." }, { status: 400 });
      const preview = await consumeTradingStrategyPreview({ userId: user.userId, previewId });
      if (!preview) return NextResponse.json({ error: "Preview is invalid, expired, or already confirmed." }, { status: 409 });
      const result = await configureTradingStrategy({
        userId: user.userId,
        connectionId: preview.connectionId,
        workspace: preview.workspace,
        lensType: preview.lensType,
        lensKey: preview.lensKey,
        methodologyVersion: preview.methodologyVersion,
        budgetUsd: preview.budgetUsd,
        arm: preview.arm,
        expectedSnapshotId: preview.snapshotId,
      });
      if (result.status === "armed") {
        const eventId = `paper-activated:${preview.snapshotId}`;
        const message = `IBKR Paper automation armed for ${preview.workspace}/${preview.lensType}:${preview.lensKey} with a $${preview.budgetUsd.toFixed(2)} budget.`;
        const inserted = await recordTradingEvent({
          connectionId: preview.connectionId,
          eventId,
          eventType: "paper_activated",
          severity: "warning",
          message,
          payload: { snapshot_id: preview.snapshotId, budget_usd: preview.budgetUsd },
        });
        if (inserted) {
          await sendTradingTelegramAlert({
            connectionId: preview.connectionId,
            eventId,
            severity: "warning",
            message,
          });
        }
      }
      return NextResponse.json(result);
    }
    const connectionId = String(body.connection_id || "");
    const workspace = String(body.workspace || "");
    const lensType = String(body.lens_type || "") as TradingLensType;
    const lensKey = lensType === "overall" ? "overall" : String(body.lens_key || "").trim();
    const methodologyVersion = String(body.methodology_version || "").trim();
    const budgetUsd = Number(body.budget_usd);
    if (!UUID_RE.test(connectionId) || !isWorkspace(workspace) || !LENSES.has(lensType)
      || !lensKey || !methodologyVersion || !Number.isFinite(budgetUsd) || budgetUsd < 100) {
      return NextResponse.json({ error: "Invalid strategy configuration." }, { status: 400 });
    }
    const result = await createTradingStrategyPreview({
      userId: user.userId,
      connectionId,
      workspace,
      lensType,
      lensKey,
      methodologyVersion,
      budgetUsd: Math.round(budgetUsd * 100) / 100,
      arm: body.arm === true,
    });
    return NextResponse.json({
      preview_id: result.previewId,
      expires_at: result.expiresAt,
      preview: result.preview,
      confirmation_required: true,
    });
  } catch (error) {
    if (error instanceof TradingUnauthorizedError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TradingDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    const message = error instanceof Error ? error.message : "Could not configure the strategy.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
