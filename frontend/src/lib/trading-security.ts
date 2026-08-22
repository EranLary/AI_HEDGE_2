import "server-only";

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { auth } from "@/auth";
import {
  flagEnabled,
  TRADING_USER_ID_RE,
  tradingMutationsEnabled,
  tradingSessionIsEligible,
} from "@/lib/trading-access-policy";
import {
  computeExecutorSignature,
  constantTimeHexEqual,
  executorTimestampIsFresh,
} from "@/lib/trading-signature";

export function isTradingControlEnabled(): boolean {
  return tradingMutationsEnabled({
    controlFlag: process.env.TRADING_CONTROL_ENABLED,
    previewFlag: process.env.AUTH_BYPASS_PREVIEW,
  });
}

export function isLiveTradingEnabled(): boolean {
  return isTradingControlEnabled() && flagEnabled(process.env.IBKR_LIVE_TRADING_ENABLED);
}

export async function requireTradingUser(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  const userId = String(session?.user?.id || "").trim();
  const email = String(session?.user?.email || "").trim().toLowerCase();
  if (!tradingSessionIsEligible(session?.user)) {
    throw new TradingUnauthorizedError();
  }
  return { userId, email };
}

export class TradingUnauthorizedError extends Error {
  constructor() {
    super("Google sign-in is required for trading controls.");
    this.name = "TradingUnauthorizedError";
  }
}

export class TradingDisabledError extends Error {
  constructor(message = "Trading mutations are disabled in this environment.") {
    super(message);
    this.name = "TradingDisabledError";
  }
}

export function requireTradingMutationEnabled(): void {
  if (!isTradingControlEnabled()) throw new TradingDisabledError();
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function matchesSha256(value: string, expectedHex: string): boolean {
  const actual = Buffer.from(sha256(value), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function generatePairingCode(): string {
  let raw = "";
  while (raw.length < 8) {
    raw += randomBytes(6).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  raw = raw.slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generateDeviceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function accountFingerprint(accountId: string): string {
  const pepper = String(process.env.TRADING_ACCOUNT_FINGERPRINT_KEY || process.env.AUTH_SECRET || "").trim();
  if (!pepper) throw new TradingDisabledError("TRADING_ACCOUNT_FINGERPRINT_KEY or AUTH_SECRET is required.");
  return createHmac("sha256", pepper).update(accountId.trim().toUpperCase(), "utf8").digest("hex");
}

export function maskAccountId(accountId: string): string {
  const clean = accountId.trim().toUpperCase();
  if (clean.length <= 4) return `***${clean}`;
  return `${clean.slice(0, 1)}***${clean.slice(-4)}`;
}

export type ExecutorAuthHeaders = {
  connectionId: string;
  secret: string;
  timestamp: string;
  nonce: string;
  signature: string;
};

export function readExecutorAuthHeaders(request: Request): ExecutorAuthHeaders {
  const authorization = request.headers.get("authorization") || "";
  const secret = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return {
    connectionId: String(request.headers.get("x-trading-connection") || "").trim(),
    secret,
    timestamp: String(request.headers.get("x-trading-timestamp") || "").trim(),
    nonce: String(request.headers.get("x-trading-nonce") || "").trim(),
    signature: String(request.headers.get("x-trading-signature") || "").trim().toLowerCase(),
  };
}

export function verifyExecutorSignature(headers: ExecutorAuthHeaders, rawBody: string): boolean {
  if (
    !TRADING_USER_ID_RE.test(headers.connectionId)
    || !headers.secret || headers.secret.length > 128
    || !headers.nonce || headers.nonce.length > 200
    || !/^[0-9a-f]{64}$/.test(headers.signature)
    || headers.timestamp.length > 20
  ) return false;
  if (!executorTimestampIsFresh(headers.timestamp)) return false;
  const expected = computeExecutorSignature({
    secret: headers.secret,
    timestamp: headers.timestamp,
    nonce: headers.nonce,
    rawBody,
  });
  return constantTimeHexEqual(expected, headers.signature);
}
