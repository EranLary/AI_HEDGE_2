import { NextResponse } from "next/server";

import { listTickersFromOutputs } from "@/lib/server-outputs";

export async function GET() {
  const tickers = listTickersFromOutputs();
  return NextResponse.json({ tickers });
}

