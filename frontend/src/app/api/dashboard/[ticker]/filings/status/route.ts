import { NextResponse } from "next/server";

import { getTickerFilingsStatus } from "@/lib/filings-engine";
import { TICKER_RE } from "@/lib/site-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  const tk = String(ticker || "").trim().toUpperCase();
  if (!TICKER_RE.test(tk)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }

  const url = new URL(req.url);
  const forceRefresh = String(url.searchParams.get("refresh") || "").trim().length > 0;

  try {
    const status = await getTickerFilingsStatus(tk, { forceRefresh });
    return NextResponse.json({
      ok: true,
      ticker: status.ticker,
      filings: status.filings,
      context_error: status.context_error || "",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch filing status: ${String(err)}` },
      { status: 500 },
    );
  }
}

