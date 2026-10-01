import { NextResponse } from "next/server";

import { getLiveYahooqueryInfo } from "@/lib/dashboard-server";

const TICKER_RE = /^[A-Z0-9.\-]{1,16}$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const normalizedTicker = String(ticker || "").trim().toUpperCase();
  if (!TICKER_RE.test(normalizedTicker)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }

  const info = await getLiveYahooqueryInfo(normalizedTicker);
  return NextResponse.json(info);
}
