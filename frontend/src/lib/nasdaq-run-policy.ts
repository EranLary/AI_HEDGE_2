import type { NasdaqUniverseStock } from "@/lib/nasdaq-universe";

export type NasdaqRunSelectionMode = "all" | "selected" | "missing_week";

export function selectNasdaqRunStocks(
  stocks: NasdaqUniverseStock[],
  opts: {
    mode: NasdaqRunSelectionMode;
    selectedTickers?: Iterable<string>;
    recentlyCompletedTickers?: Iterable<string>;
    resumedReleaseTickers?: Iterable<string>;
  },
): NasdaqUniverseStock[] {
  const normalized = (values: Iterable<string> | undefined) => new Set(
    Array.from(values || [], (value) => String(value || "").trim().toUpperCase()).filter(Boolean),
  );

  if (opts.resumedReleaseTickers) {
    const completed = normalized(opts.resumedReleaseTickers);
    return stocks.filter((stock) => !completed.has(stock.ticker));
  }
  if (opts.mode === "selected") {
    const selected = normalized(opts.selectedTickers);
    return stocks.filter((stock) => selected.has(stock.ticker));
  }
  if (opts.mode === "missing_week") {
    const recent = normalized(opts.recentlyCompletedTickers);
    return stocks.filter((stock) => !recent.has(stock.ticker));
  }
  return [...stocks];
}

