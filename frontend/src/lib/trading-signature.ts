import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const EXECUTOR_CLOCK_SKEW_SECONDS = 300;

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function computeExecutorSignature(args: {
  secret: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  const payload = `${args.timestamp}\n${args.nonce}\n${sha256Text(args.rawBody)}`;
  return createHmac("sha256", args.secret).update(payload, "utf8").digest("hex");
}

export function executorTimestampIsFresh(timestamp: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const parsed = Number(timestamp);
  return Number.isFinite(parsed) && Math.abs(nowSeconds - parsed) <= EXECUTOR_CLOCK_SKEW_SECONDS;
}

export function constantTimeHexEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}
