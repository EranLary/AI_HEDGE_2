import { NextResponse } from "next/server";

import { filterExcludedTickers } from "@/lib/excluded-tickers";
import { listAllTickerSymbols } from "@/lib/reports-db";
import { listTickersFromOutputs } from "@/lib/server-outputs";

export async function GET() {
  try {
    const dbTickers = await listAllTickerSymbols();
    if (dbTickers.length) {
      return NextResponse.json({ tickers: filterExcludedTickers(dbTickers) });
    }
  } catch (err) {
    console.warn("[tickers] DB read failed:", err);
  }
  const tickers = filterExcludedTickers(listTickersFromOutputs());
  return NextResponse.json({ tickers });
}
