const EXCLUDED_TICKERS = new Set(["HSBK.IL"]);

export function normalizeTicker(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

export function isExcludedTicker(value: unknown): boolean {
  const ticker = normalizeTicker(value);
  return Boolean(ticker && EXCLUDED_TICKERS.has(ticker));
}

export function filterExcludedTickers<T>(
  rows: T[],
  getTicker: (row: T) => unknown = (row) => row,
): T[] {
  return rows.filter((row) => !isExcludedTicker(getTicker(row)));
}
