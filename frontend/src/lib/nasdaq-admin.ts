import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { auth } from "@/auth";
import { hostnameFromRequestUrl, shouldBypassAuthForHostname } from "@/lib/auth-bypass";

export const NASDAQ_RUN_COOKIE = "hib-nasdaq-run-auth";
export const NASDAQ_RUN_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const DEFAULT_ADMIN_EMAIL = "eranlarymail@gmail.com";
const DEFAULT_PASSWORD_SHA256 = "6c70d0999b3ebf01e76e81a772ae9d04866bc6eb0bd58c8cb56ffbd999c44c83";
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

type AttemptWindow = { count: number; startedAt: number };
const failedAttempts = new Map<string, AttemptWindow>();

export class NasdaqAdminError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "NasdaqAdminError";
    this.status = status;
  }
}

export type NasdaqAdmin = {
  email: string;
  userId: string | null;
  bypass: boolean;
};

function allowedEmails(): Set<string> {
  const raw = process.env.NASDAQ_ADMIN_EMAILS || DEFAULT_ADMIN_EMAIL;
  return new Set(raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export async function requireNasdaqAdmin(request: Request): Promise<NasdaqAdmin> {
  const bypass = shouldBypassAuthForHostname(hostnameFromRequestUrl(request.url));
  if (bypass) return { email: DEFAULT_ADMIN_EMAIL, userId: null, bypass: true };

  const session = await auth();
  const email = String(session?.user?.email || "").trim().toLowerCase();
  if (!email || session?.user?.isGuest || !allowedEmails().has(email)) {
    throw new NasdaqAdminError("This action is restricted to the Nasdaq 100 administrator.");
  }
  return { email, userId: session?.user?.id || null, bypass: false };
}

export async function tryNasdaqAdmin(request: Request): Promise<NasdaqAdmin | null> {
  try {
    return await requireNasdaqAdmin(request);
  } catch {
    return null;
  }
}

function authSecret(): string {
  const secret = process.env.NASDAQ_RUN_AUTH_SECRET || process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "nasdaq-run-local-development-only";
  throw new NasdaqAdminError("Nasdaq run authorization is not configured.", 503);
}

function passwordDigest(): Buffer {
  const raw = (process.env.NASDAQ_RUN_PASSWORD_SHA256 || DEFAULT_PASSWORD_SHA256).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) {
    throw new NasdaqAdminError("Nasdaq run password is not configured correctly.", 503);
  }
  return Buffer.from(raw, "hex");
}

function attemptKey(request: Request, email: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${email}:${forwarded}`;
}

function currentAttempt(key: string): AttemptWindow | null {
  const attempt = failedAttempts.get(key);
  if (!attempt) return null;
  if (Date.now() - attempt.startedAt >= FAILURE_WINDOW_MS) {
    failedAttempts.delete(key);
    return null;
  }
  return attempt;
}

export function verifyNasdaqRunPassword(request: Request, email: string, password: string): void {
  const key = attemptKey(request, email);
  const existing = currentAttempt(key);
  if (existing && existing.count >= MAX_FAILURES) {
    throw new NasdaqAdminError("Too many password attempts. Try again in ten minutes.", 429);
  }

  const supplied = createHash("sha256").update(String(password || ""), "utf8").digest();
  const expected = passwordDigest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    const active = currentAttempt(key);
    failedAttempts.set(key, active
      ? { ...active, count: active.count + 1 }
      : { count: 1, startedAt: Date.now() });
    throw new NasdaqAdminError("Incorrect run password.", 401);
  }
  failedAttempts.delete(key);
}

function cookieValue(request: Request): string | null {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === NASDAQ_RUN_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function createNasdaqRunToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({
    email: email.toLowerCase(),
    exp: Date.now() + NASDAQ_RUN_COOKIE_MAX_AGE_SECONDS * 1000,
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function hasNasdaqRunAuthorization(request: Request, email: string): boolean {
  const token = cookieValue(request);
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", authSecret()).update(payload).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown; exp?: unknown };
    return String(parsed.email || "").toLowerCase() === email.toLowerCase()
      && Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

