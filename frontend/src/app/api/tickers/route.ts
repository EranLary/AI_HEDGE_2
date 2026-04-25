import { NextResponse } from "next/server";

import { listAllTickerSymbols } from "@/lib/reports-db";
import { listTickersFromOutputs } from "@/lib/server-outputs";

export async function GET() {
  try {
    const dbTickers = await listAllTickerSymbols();
    if (dbTickers.length) {
      return NextResponse.json({ tickers: dbTickers });
    }
  } catch (err) {
    console.warn("[tickers] DB read failed:", err);
  }
  const tickers = listTickersFromOutputs();
  return NextResponse.json({ tickers });
}
