import { NextResponse } from "next/server";

import { yahooValidate } from "@/lib/yahoo-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase();
  if (!ticker || !TICKER_RE.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Invalid ticker format." }, { status: 400 });
  }

  const result = await yahooValidate(ticker);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }
  return NextResponse.json(result);
}
