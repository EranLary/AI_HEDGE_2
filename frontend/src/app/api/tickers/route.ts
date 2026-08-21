import { NextResponse } from "next/server";

import { filterExcludedTickers } from "@/lib/excluded-tickers";
import { listAllTickerSymbols } from "@/lib/reports-db";
import { listTickersFromOutputs } from "@/lib/server-outputs";
import { parseApiWorkspace } from "@/lib/workspace";

export async function GET(request: Request) {
  const workspace = parseApiWorkspace(new URL(request.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  try {
    const dbTickers = await listAllTickerSymbols(workspace);
    if (dbTickers.length) {
      return NextResponse.json({ tickers: filterExcludedTickers(dbTickers) });
    }
  } catch (err) {
    console.warn("[tickers] DB read failed:", err);
  }
  const tickers = workspace === "analysis" ? filterExcludedTickers(listTickersFromOutputs()) : [];
  return NextResponse.json({ tickers });
}
