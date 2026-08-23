import { NextResponse } from "next/server";

import { consumeTradingPairing } from "@/lib/trading-db";
import {
  accountFingerprint,
  generateDeviceSecret,
  maskAccountId,
  normalizePairingCode,
  requireTradingMutationEnabled,
  sha256,
  TradingDisabledError,
} from "@/lib/trading-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireTradingMutationEnabled();
    const body = await request.json() as Record<string, unknown>;
    const code = normalizePairingCode(String(body.code || ""));
    const mode = String(body.mode || "paper");
    const accountId = String(body.account_id || "").trim().toUpperCase();
    const executorVersion = String(body.executor_version || "unknown").trim().slice(0, 100);
    if (code.length !== 8 || mode !== "paper" || !accountId || accountId.length > 50) {
      return NextResponse.json({ error: "Invalid Paper pairing request." }, { status: 400 });
    }
    const deviceSecret = generateDeviceSecret();
    const connectionId = await consumeTradingPairing({
      codeHash: sha256(code),
      deviceSecretHash: sha256(deviceSecret),
      accountFingerprint: accountFingerprint(accountId),
      accountMasked: maskAccountId(accountId),
      mode: "paper",
      executorVersion,
    });
    if (!connectionId) return NextResponse.json({ error: "Pairing code is invalid or expired." }, { status: 401 });
    return NextResponse.json({
      connection_id: connectionId,
      device_secret: deviceSecret,
      mode: "paper",
      account_masked: maskAccountId(accountId),
    });
  } catch (error) {
    if (error instanceof TradingDisabledError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("[trading] executor pairing failed", error);
    return NextResponse.json({ error: "Executor pairing failed." }, { status: 500 });
  }
}
