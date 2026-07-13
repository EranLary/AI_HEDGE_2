import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

import { yahooChartHistory } from "@/lib/yahoo-lookup";

const TICKER_RE = /^[A-Z0-9.\-]{1,16}$/;
const MAX_TICKERS = 10;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FundamentalRow = {
  ticker?: string;
  symbol?: string;
  company_name?: string;
  market_cap?: number | null;
  enterprise_value?: number | null;
  net_cash_debt?: number | null;
  trailing_pe?: number | null;
  forward_pe?: number | null;
  ev_sales?: number | null;
  ev_ebitda?: number | null;
  p_fcf?: number | null;
  revenue_growth?: number | null;
  earnings_growth?: number | null;
  gross_margin?: number | null;
  operating_margin?: number | null;
  profit_margin?: number | null;
  roe?: number | null;
  current_ratio?: number | null;
  debt_to_equity?: number | null;
  dividend_yield?: number | null;
  target_upside?: number | null;
  financials_copy?: unknown;
};

function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

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

function runFundamentalsScript(
  tickers: string[],
  includeFinancials: boolean,
): Promise<{ rows: FundamentalRow[]; not_found: string[] }> {
  return new Promise((resolve) => {
    if (!tickers.length) {
      resolve({ rows: [], not_found: [] });
      return;
    }

    const root = repoRoot();
    const scriptPath = path.resolve(root, "scripts", "compare_stock_info.py");
    const pythonExe = process.env.PYTHON_EXECUTABLE || "python";
    const args = [scriptPath, "--tickers", tickers.join(","), "--workers", "6"];
    if (includeFinancials) args.push("--include-financials");
    const child = spawn(pythonExe, args, {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: path.resolve(root, "src"),
      },
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => resolve({ rows: [], not_found: [] }));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ rows: [], not_found: [] });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { rows?: FundamentalRow[]; not_found?: string[] };
        resolve({
          rows: Array.isArray(parsed.rows) ? parsed.rows : [],
          not_found: Array.isArray(parsed.not_found) ? parsed.not_found.map((t) => String(t).toUpperCase()) : [],
        });
      } catch {
        resolve({ rows: [], not_found: [] });
      }
    });
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tickers = normalizeTickers(url.searchParams.get("tickers"));
  const includeFinancials = ["1", "true", "yes"].includes(
    String(url.searchParams.get("financials") || "").toLowerCase(),
  );
  if (!tickers.length) {
    return NextResponse.json({ status: "unavailable", series: [], not_found: [], error: "Add at least one ticker." });
  }

  const [fundamentals, settled] = await Promise.all([
    runFundamentalsScript(tickers, includeFinancials),
    Promise.all(tickers.map(async (ticker) => {
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
    })),
  ]);

  const fundamentalsByTicker = new Map(
    fundamentals.rows.map((row) => [String(row.ticker || row.symbol || "").toUpperCase(), row]),
  );

  const series = settled
    .filter((row): row is Extract<(typeof settled)[number], { ok: true }> => row.ok)
    .map((row) => ({
      ...row,
      fundamentals: fundamentalsByTicker.get(row.ticker) || null,
    }));
  const chartNotFound = settled.filter((row) => !row.ok).map((row) => row.ticker);
  const notFound = Array.from(new Set([...chartNotFound, ...fundamentals.not_found])).filter(
    (ticker) => !series.some((row) => row.ticker === ticker),
  );
  const financialsCopy = includeFinancials
    ? {
        generated_at: new Date().toISOString(),
        tickers,
        data: Object.fromEntries(
          fundamentals.rows
            .map((row) => [String(row.ticker || row.symbol || "").toUpperCase(), row.financials_copy] as const)
            .filter(([ticker, payload]) => ticker && payload),
        ),
        not_found: notFound,
      }
    : undefined;

  return NextResponse.json({
    status: series.length ? "success" : "unavailable",
    generated_at: new Date().toISOString(),
    series,
    not_found: notFound,
    ...(financialsCopy ? { financials: financialsCopy } : {}),
    error: series.length ? "" : "We tried Yahoo, shook the data tree, and nothing tradable fell out.",
  });
}
