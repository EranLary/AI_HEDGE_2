import { NextResponse } from "next/server";

import { yahooSearch } from "@/lib/yahoo-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ results: [] });

  const limitRaw = Number(url.searchParams.get("limit") || "8");
  const limit = Math.max(1, Math.min(20, Number.isFinite(limitRaw) ? limitRaw : 8));

  const results = await yahooSearch(q, limit);
  return NextResponse.json({ results });
}
