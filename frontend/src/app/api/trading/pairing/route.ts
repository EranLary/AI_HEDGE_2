import { NextResponse } from "next/server";

import { createTradingPairing } from "@/lib/trading-db";
import {
  generatePairingCode,
  normalizePairingCode,
  requireTradingMutationEnabled,
  requireTradingUser,
  sha256,
  TradingDisabledError,
  TradingUnauthorizedError,
} from "@/lib/trading-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireTradingMutationEnabled();
    const user = await requireTradingUser();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const requestedConnectionId = String(body.connection_id || "").trim();
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const connectionId = await createTradingPairing({
      userId: user.userId,
      mode: "paper",
      codeHash: sha256(normalizePairingCode(code)),
      expiresAt,
      connectionId: requestedConnectionId || undefined,
    });
    return NextResponse.json({ connection_id: connectionId, code, mode: "paper", expires_at: expiresAt });
  } catch (error) {
    if (error instanceof TradingUnauthorizedError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof TradingDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("[trading] pairing failed", error);
    return NextResponse.json({ error: "Could not create the pairing code." }, { status: 500 });
  }
}
