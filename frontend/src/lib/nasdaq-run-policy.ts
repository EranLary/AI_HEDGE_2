import type { NasdaqUniverseStock } from "@/lib/nasdaq-universe";

export type NasdaqRunSelectionMode = "all" | "selected" | "missing_week";

const KNOWN_ISSUER_GROUPS = [
  { canonicalTicker: "GOOGL", tickers: ["GOOGL", "GOOG"] },
] as const;

const knownIssuerKeyByTicker = new Map<string, string>();
const knownIssuerTickersByKey = new Map<string, readonly string[]>();
for (const group of KNOWN_ISSUER_GROUPS) {
  const key = `ticker:${group.canonicalTicker}`;
  knownIssuerTickersByKey.set(key, group.tickers);
  for (const ticker of group.tickers) knownIssuerKeyByTicker.set(ticker, key);
}

function cleanTicker(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function issuerNameKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\b(?:CLASS|CL)\s+[A-Z0-9]+\b.*$/, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function issuerKey(stock: NasdaqUniverseStock): string {
  const ticker = cleanTicker(stock.ticker);
  const knownKey = knownIssuerKeyByTicker.get(ticker);
  if (knownKey) return knownKey;
  const nameKey = issuerNameKey(stock.companyName);
  return nameKey ? `name:${nameKey}` : `ticker:${ticker}`;
}

function rankValue(stock: NasdaqUniverseStock): number {
  return stock.rank == null || !Number.isFinite(stock.rank) ? Number.POSITIVE_INFINITY : stock.rank;
}

function preferCandidate(
  key: string,
  existing: NasdaqUniverseStock,
  candidate: NasdaqUniverseStock,
): boolean {
  const canonicalTicker = key.startsWith("ticker:") ? key.slice("ticker:".length) : "";
  const existingIsCanonical = cleanTicker(existing.ticker) === canonicalTicker;
  const candidateIsCanonical = cleanTicker(candidate.ticker) === canonicalTicker;
  if (existingIsCanonical !== candidateIsCanonical) return candidateIsCanonical;
  if (rankValue(existing) !== rankValue(candidate)) return rankValue(candidate) < rankValue(existing);
  return cleanTicker(candidate.ticker).localeCompare(cleanTicker(existing.ticker)) < 0;
}

/**
 * Collapse multiple listed share classes into one executable company row.
 * Known groups have an explicit canonical ticker; otherwise the best-ranked
 * security from rows sharing the same issuer name is retained.
 */
export function deduplicateNasdaqIssuerStocks(stocks: NasdaqUniverseStock[]): NasdaqUniverseStock[] {
  const groups = new Map<string, { stock: NasdaqUniverseStock; aliases: Set<string> }>();

  for (const rawStock of stocks) {
    const ticker = cleanTicker(rawStock.ticker);
    if (!ticker) continue;
    const stock = { ...rawStock, ticker };
    const key = issuerKey(stock);
    const aliases = [ticker, ...(rawStock.aliases || []).map(cleanTicker)].filter(Boolean);
    const knownAliases = knownIssuerTickersByKey.get(key) || [];
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { stock, aliases: new Set([...knownAliases, ...aliases]) });
      continue;
    }
    for (const alias of [...knownAliases, ...aliases]) existing.aliases.add(alias);
    if (preferCandidate(key, existing.stock, stock)) existing.stock = stock;
  }

  return Array.from(groups.values(), ({ stock, aliases }) => ({
    ...stock,
    aliases: Array.from(aliases),
  }));
}

export function selectNasdaqRunStocks(
  stocks: NasdaqUniverseStock[],
  opts: {
    mode: NasdaqRunSelectionMode;
    selectedTickers?: Iterable<string>;
    recentlyCompletedTickers?: Iterable<string>;
    resumedReleaseTickers?: Iterable<string>;
  },
): NasdaqUniverseStock[] {
  const uniqueStocks = deduplicateNasdaqIssuerStocks(stocks);
  const tickerByAlias = new Map<string, string>();
  for (const stock of uniqueStocks) {
    tickerByAlias.set(cleanTicker(stock.ticker), stock.ticker);
    for (const alias of stock.aliases || []) tickerByAlias.set(cleanTicker(alias), stock.ticker);
  }
  const normalized = (values: Iterable<string> | undefined) => new Set(
    Array.from(values || [], (value) => cleanTicker(value))
      .filter(Boolean)
      .map((ticker) => tickerByAlias.get(ticker) || ticker),
  );

  if (opts.resumedReleaseTickers) {
    const completed = normalized(opts.resumedReleaseTickers);
    return uniqueStocks.filter((stock) => !completed.has(stock.ticker));
  }
  if (opts.mode === "selected") {
    const selected = normalized(opts.selectedTickers);
    return uniqueStocks.filter((stock) => selected.has(stock.ticker));
  }
  if (opts.mode === "missing_week") {
    const recent = normalized(opts.recentlyCompletedTickers);
    return uniqueStocks.filter((stock) => !recent.has(stock.ticker));
  }
  return uniqueStocks;
}

