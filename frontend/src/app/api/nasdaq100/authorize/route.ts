import { NextResponse } from "next/server";

import {
  createNasdaqRunToken,
  NASDAQ_RUN_COOKIE,
  NASDAQ_RUN_COOKIE_MAX_AGE_SECONDS,
  NasdaqAdminError,
  requireNasdaqAdmin,
  verifyNasdaqRunPassword,
} from "@/lib/nasdaq-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const admin = await requireNasdaqAdmin(request);
    const body = (await request.json()) as { password?: unknown };
    verifyNasdaqRunPassword(request, admin.email, String(body.password || ""));
    const response = NextResponse.json({ ok: true, authorized: true });
    response.cookies.set(NASDAQ_RUN_COOKIE, createNasdaqRunToken(admin.email), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/nasdaq100",
      maxAge: NASDAQ_RUN_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const status = error instanceof NasdaqAdminError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Authorization failed.";
    return NextResponse.json({ error: message }, { status });
  }
}

