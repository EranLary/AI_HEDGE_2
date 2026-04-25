import { NextResponse } from "next/server";

import { getLivePerformance } from "@/lib/dashboard-server";

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const tk = String(ticker || "").trim().toUpperCase();
  if (!TICKER_RE.test(tk)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }
  const result = await getLivePerformance(tk);
  return NextResponse.json(result);
}
