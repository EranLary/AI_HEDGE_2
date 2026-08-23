import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { deduplicateNasdaqIssuerStocks } from "@/lib/nasdaq-run-policy";

export type NasdaqUniverseStock = {
  ticker: string;
  companyName: string;
  rank: number | null;
  aliases?: string[];
};

export type NasdaqUniverseSnapshot = {
  source: string;
  sourceUrl: string | null;
  asOf: string | null;
  stocks: NasdaqUniverseStock[];
};

type RawUniverse = {
  source?: unknown;
  source_url?: unknown;
  generated_at?: unknown;
  as_of?: unknown;
  rows?: unknown;
};

function repositoryRoot(): string {
  return path.resolve(process.cwd(), "..");
}

export function normalizeNasdaqUniverse(raw: RawUniverse): NasdaqUniverseStock[] {
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const byTicker = new Map<string, NasdaqUniverseStock>();
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const ticker = String(row.query_ticker || row.ticker || "").trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,10}$/.test(ticker) || byTicker.has(ticker)) continue;
    const companyName = String(row.company_name || row.name || ticker).trim() || ticker;
    const rankValue = Number(row.rank);
    byTicker.set(ticker, {
      ticker,
      companyName,
      rank: Number.isFinite(rankValue) ? rankValue : null,
    });
  }
  const sorted = Array.from(byTicker.values()).sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    return a.ticker.localeCompare(b.ticker);
  });
  return deduplicateNasdaqIssuerStocks(sorted);
}

async function readUniverseFile(filePath: string): Promise<{ raw: RawUniverse; modifiedAt: string } | null> {
  try {
    const [contents, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
    return { raw: JSON.parse(contents) as RawUniverse, modifiedAt: stat.mtime.toISOString() };
  } catch {
    return null;
  }
}

export async function loadNasdaqUniverse(): Promise<NasdaqUniverseSnapshot> {
  const root = repositoryRoot();
  const cache = await readUniverseFile(path.resolve(root, "outputs", "_screeners", "nasdaq100_profiles.json"));
  if (cache) {
    const stocks = normalizeNasdaqUniverse(cache.raw);
    if (stocks.length) {
      return {
        source: String(cache.raw.source || "Nasdaq 100 screener cache"),
        sourceUrl: cache.raw.source_url ? String(cache.raw.source_url) : null,
        asOf: String(cache.raw.generated_at || cache.raw.as_of || cache.modifiedAt),
        stocks,
      };
    }
  }

  const seed = await readUniverseFile(
    path.resolve(root, "src", "ai_hedge", "static_data", "nasdaq100_slickcharts_seed.json"),
  );
  if (!seed) throw new Error("The Nasdaq 100 universe seed is unavailable.");
  const stocks = normalizeNasdaqUniverse(seed.raw);
  if (!stocks.length) throw new Error("The Nasdaq 100 universe is empty.");
  return {
    source: `${String(seed.raw.source || "Slickcharts")} fallback seed`,
    sourceUrl: seed.raw.source_url ? String(seed.raw.source_url) : null,
    asOf: String(seed.raw.generated_at || seed.raw.as_of || seed.modifiedAt),
    stocks,
  };
}

