import { NextResponse } from "next/server";

import { yahooPriceHistory } from "@/lib/yahoo-lookup";

const TICKER_RE = /^[A-Z0-9.\-]{1,16}$/;
const MAX_TICKERS = 6;

export const runtime = "nodejs";

function normalizeTickers(primary: string, raw: string | null): string[] {
  const seen = new Set<string>();
  const candidates = [primary, ...(raw || "").split(",")];
  const out: string[] = [];
  for (const candidate of candidates) {
    const ticker = String(candidate || "").trim().toUpperCase();
    if (!ticker || seen.has(ticker) || !TICKER_RE.test(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

export async function GET(req: Request, context: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await context.params;
  const url = new URL(req.url);
  const tickers = normalizeTickers(ticker, url.searchParams.get("tickers"));
  if (tickers.length < 2) {
    return NextResponse.json({ status: "unavailable", series: [], error: "At least two valid tickers are required." });
  }

  const settled = await Promise.all(
    tickers.map(async (tk) => {
      const prices = await yahooPriceHistory(tk, "5y");
      return prices.length >= 2 ? { ticker: tk, prices } : null;
    }),
  );
  const series = settled.filter((item): item is { ticker: string; prices: Awaited<ReturnType<typeof yahooPriceHistory>> } =>
    Boolean(item),
  );

  return NextResponse.json({
    status: series.length >= 2 ? "success" : "unavailable",
    generated_at: new Date().toISOString(),
    period: "5y",
    series,
    error: series.length >= 2 ? "" : "Yahoo price history was unavailable for enough market tickers.",
  });
}
