/** Server-side helpers for Yahoo Finance unofficial endpoints.
 *
 * yfinance reads the same endpoints, so behavior here matches what
 * src/ai_hedge/runner.py would later see when calling yf.Ticker(...).info.
 */

export type TickerEntry = {
  s: string; // symbol
  n: string; // name
  e: string; // exchange
  t: "stock" | "etf" | "index" | "currency" | "crypto" | "future" | "option" | "other";
};

const SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search";
// v7/finance/quote requires a crumb+cookie since 2023, so we use the chart
// endpoint (still public) which yfinance also relies on.
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

const YAHOO_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

type CacheEntry<T> = { value: T; expiresAt: number };
const searchCache = new Map<string, CacheEntry<TickerEntry[]>>();
const validateCache = new Map<string, CacheEntry<ValidationResult>>();
const SEARCH_TTL_MS = 10 * 60 * 1000;
const VALIDATE_TTL_MS = 60 * 60 * 1000;

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number) {
  map.set(key, { value, expiresAt: Date.now() + ttl });
}

function normalizeQuoteType(raw: unknown): TickerEntry["t"] {
  const v = String(raw || "").toUpperCase();
  if (v === "EQUITY") return "stock";
  if (v === "ETF") return "etf";
  if (v === "INDEX") return "index";
  if (v === "CURRENCY") return "currency";
  if (v === "CRYPTOCURRENCY") return "crypto";
  if (v === "FUTURE") return "future";
  if (v === "OPTION") return "option";
  return "other";
}

function pickName(quote: Record<string, unknown>): string {
  const long = String(quote.longname || quote.longName || "").trim();
  const short = String(quote.shortname || quote.shortName || "").trim();
  return long || short || String(quote.symbol || "").trim();
}

function pickExchange(quote: Record<string, unknown>): string {
  const display = String(quote.exchDisp || quote.fullExchangeName || "").trim();
  if (display) return display;
  const exchange = String(quote.exchange || "").trim().toUpperCase();
  // yfinance-style suffix → friendly label
  const symbol = String(quote.symbol || "").toUpperCase();
  if (symbol.endsWith(".TA")) return "TASE";
  if (symbol.endsWith(".L")) return "LSE";
  return exchange || "—";
}

// Yahoo uses "-" for US share classes (BRK-B, BF-B) but "." for international
// exchange suffixes (TEVA.TA, BARC.L). Map our canonical SEC-style symbol to
// Yahoo's URL form. If the part after the last dot looks like an exchange code,
// keep the dot; otherwise treat it as a share-class suffix and convert to dash.
const KNOWN_EXCHANGE_SUFFIXES = new Set([
  "TA", "L", "IL", "TO", "V", "CN", "NEO", "NE",
  "PA", "AS", "DE", "F", "MU", "HM", "HA", "DU", "BE", "SG", "MI", "MC", "BR", "VI", "VS", "ST", "OL", "HE", "CO", "IC", "IR",
  "SW", "PRA", "WA", "BD", "AT", "MX", "SA", "BA", "CL", "ME", "TI", "TWN",
  "AX", "NZ", "JK", "BK", "KS", "KQ", "T", "HK", "SS", "SZ", "NS", "BO", "KL",
  "JO", "QA", "AE", "EG", "KW", "OQ", "OK",
]);

function toYahooSymbol(sym: string): string {
  const dot = sym.lastIndexOf(".");
  if (dot < 0) return sym;
  const suffix = sym.slice(dot + 1).toUpperCase();
  if (KNOWN_EXCHANGE_SUFFIXES.has(suffix)) return sym;
  // Likely a US share class (e.g. BRK.B, BF.B, RDS.A) — Yahoo wants a dash.
  return sym.slice(0, dot) + "-" + sym.slice(dot + 1);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: YAHOO_HEADERS, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** Search Yahoo for matching symbols (used as autocomplete fallback). */
export async function yahooSearch(query: string, limit = 8): Promise<TickerEntry[]> {
  const q = query.trim();
  if (!q) return [];
  const cacheKey = `${q.toLowerCase()}|${limit}`;
  const cached = cacheGet(searchCache, cacheKey);
  if (cached) return cached;

  const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&quotesCount=${limit}&newsCount=0&listsCount=0`;
  let results: TickerEntry[] = [];
  try {
    const res = await fetchWithTimeout(url, 4000);
    if (!res.ok) return [];
    const json = (await res.json()) as { quotes?: Array<Record<string, unknown>> };
    const quotes = Array.isArray(json.quotes) ? json.quotes : [];
    results = quotes
      .map((q) => {
        const symbol = String(q.symbol || "").trim().toUpperCase();
        if (!symbol) return null;
        return {
          s: symbol,
          n: pickName(q),
          e: pickExchange(q),
          t: normalizeQuoteType(q.quoteType),
        } satisfies TickerEntry;
      })
      .filter((x): x is TickerEntry => x !== null);
  } catch (err) {
    console.warn("[yahoo-lookup] search failed", err);
    return [];
  }

  cacheSet(searchCache, cacheKey, results, SEARCH_TTL_MS);
  return results;
}

export type ValidationResult =
  | { ok: true; ticker: string; name: string; exchange: string; instrumentType: string }
  | { ok: false; error: string };

/** Verify a ticker resolves on Yahoo (same chart endpoint yfinance uses). */
export async function yahooValidate(ticker: string, timeoutMs = 3000): Promise<ValidationResult> {
  const sym = ticker.trim().toUpperCase();
  if (!sym) return { ok: false, error: "Empty ticker." };
  const cached = cacheGet(validateCache, sym);
  if (cached) return cached;

  const yahooSym = toYahooSymbol(sym);
  const url = `${CHART_URL}/${encodeURIComponent(yahooSym)}?range=1d&interval=1d`;
  let result: ValidationResult;
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (res.status === 404) {
      result = { ok: false, error: `Ticker '${sym}' not found on Yahoo Finance.` };
      cacheSet(validateCache, sym, result, VALIDATE_TTL_MS);
      return result;
    }
    if (!res.ok) {
      // 429 / 5xx: treat as transient, do NOT cache the failure
      console.warn(`[yahoo-lookup] validate HTTP ${res.status} for ${sym}`);
      return { ok: false, error: `Yahoo lookup failed (${res.status}).` };
    }
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            symbol?: string;
            shortName?: string;
            longName?: string;
            fullExchangeName?: string;
            exchangeName?: string;
            instrumentType?: string;
            regularMarketPrice?: number;
          };
        }>;
        error?: unknown;
      };
    };
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta || !meta.symbol) {
      result = { ok: false, error: `Ticker '${sym}' not found on Yahoo Finance.` };
    } else {
      const name = String(meta.longName || meta.shortName || "").trim() || sym;
      const exchange = String(meta.fullExchangeName || meta.exchangeName || "").trim() || "—";
      const instrumentType = String(meta.instrumentType || "").trim().toUpperCase();
      result = { ok: true, ticker: sym, name, exchange, instrumentType };
    }
  } catch (err) {
    const isAbort = (err as Error)?.name === "AbortError";
    console.warn(`[yahoo-lookup] validate ${isAbort ? "timeout" : "error"} for ${sym}`, err);
    return { ok: false, error: isAbort ? "Yahoo lookup timed out." : "Yahoo lookup failed." };
  }

  cacheSet(validateCache, sym, result, VALIDATE_TTL_MS);
  return result;
}
