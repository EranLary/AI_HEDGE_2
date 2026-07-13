import { NextResponse } from "next/server";

import { yahooChartHistory } from "@/lib/yahoo-lookup";

const TICKER_RE = /^[A-Z0-9.\-]{1,16}$/;
const MAX_TICKERS = 10;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeTickers(raw: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of (raw || "").split(",")) {
    const ticker = item.trim().toUpperCase();
    if (!ticker || seen.has(ticker) || !TICKER_RE.test(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
    if (out.length >= MAX_TICKERS) break;
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tickers = normalizeTickers(url.searchParams.get("tickers"));
  if (!tickers.length) {
    return NextResponse.json({ status: "unavailable", series: [], not_found: [], error: "Add at least one ticker." });
  }

  const settled = await Promise.all(
    tickers.map(async (ticker) => {
      const result = await yahooChartHistory(ticker, "5y");
      if (result.prices.length < 2) return { ticker, ok: false as const };
      return {
        ticker,
        ok: true as const,
        company_name: result.meta.longName || result.meta.shortName || ticker,
        exchange: result.meta.fullExchangeName || result.meta.exchangeName || "",
        currency: result.meta.currency || "",
        current_price: result.meta.regularMarketPrice ?? result.prices[result.prices.length - 1]?.close ?? null,
        volume: result.meta.regularMarketVolume ?? null,
        fifty_two_week_high: result.meta.fiftyTwoWeekHigh ?? null,
        fifty_two_week_low: result.meta.fiftyTwoWeekLow ?? null,
        prices: result.prices,
      };
    }),
  );

  const series = settled.filter((row): row is Extract<(typeof settled)[number], { ok: true }> => row.ok);
  const notFound = settled.filter((row) => !row.ok).map((row) => row.ticker);

  return NextResponse.json({
    status: series.length ? "success" : "unavailable",
    generated_at: new Date().toISOString(),
    series,
    not_found: notFound,
    error: series.length ? "" : "We tried Yahoo, shook the data tree, and nothing tradable fell out.",
  });
}
