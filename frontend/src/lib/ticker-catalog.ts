"use client";

import Fuse from "fuse.js";

import { filterExcludedTickers, isExcludedTicker } from "@/lib/excluded-tickers";

export type TickerEntry = {
  s: string; // symbol
  n: string; // name
  e: string; // exchange
  t: "stock" | "etf" | "index" | "currency" | "crypto" | "future" | "option" | "other";
};

let catalogPromise: Promise<TickerEntry[]> | null = null;
let fuseInstance: Fuse<TickerEntry> | null = null;

/** Lazy, memoized fetch of /data/tickers.json. Subsequent calls return cached array. */
export function loadTickerCatalog(): Promise<TickerEntry[]> {
  if (catalogPromise) return catalogPromise;
  catalogPromise = fetch("/data/tickers.json", { cache: "force-cache" })
    .then((res) => {
      if (!res.ok) throw new Error(`tickers.json HTTP ${res.status}`);
      return res.json() as Promise<TickerEntry[]>;
    })
    .then((rows) => filterExcludedTickers(rows, (row) => row.s))
    .catch((err) => {
      console.warn("[ticker-catalog] failed to load", err);
      catalogPromise = null;
      return [];
    });
  return catalogPromise;
}

export function buildFuse(catalog: TickerEntry[]): Fuse<TickerEntry> {
  if (fuseInstance) return fuseInstance;
  fuseInstance = new Fuse(catalog, {
    keys: [
      { name: "s", weight: 0.7 },
      { name: "n", weight: 0.3 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
    minMatchCharLength: 1,
    includeScore: true,
  });
  return fuseInstance;
}

/** Run fuzzy search against the catalog. Returns up to `limit` entries, ranked.
 *
 * Layers (high → low priority, deduped by symbol):
 *   1. Exact symbol match
 *   2. Symbol prefix match
 *   3. Name word starts with query
 *   4. Symbol contains query as substring
 *   5. Fuse fuzzy fallback (catches typos like "nvde" → "NVDA")
 */
export function searchCatalog(catalog: TickerEntry[], query: string, limit = 8): TickerEntry[] {
  const q = query.trim();
  if (!q) return [];
  const qUp = q.toUpperCase();
  const qLow = q.toLowerCase();
  if (isExcludedTicker(qUp)) return [];

  const out: TickerEntry[] = [];
  const seen = new Set<string>();
  const push = (e: TickerEntry) => {
    if (seen.has(e.s)) return;
    seen.add(e.s);
    out.push(e);
  };

  const exact: TickerEntry[] = [];
  const symbolPrefix: TickerEntry[] = [];
  const nameWordPrefix: TickerEntry[] = [];
  const symbolContains: TickerEntry[] = [];

  for (const e of catalog) {
    if (out.length + exact.length + symbolPrefix.length + nameWordPrefix.length + symbolContains.length > limit * 6) break;
    const sym = e.s;
    if (isExcludedTicker(sym)) continue;
    if (sym === qUp) {
      exact.push(e);
      continue;
    }
    if (sym.startsWith(qUp)) {
      symbolPrefix.push(e);
      continue;
    }
    const nameLow = e.n.toLowerCase();
    // word-prefix: query starts a token in the company name
    if (nameLow.startsWith(qLow) || nameLow.includes(" " + qLow)) {
      nameWordPrefix.push(e);
      continue;
    }
    if (sym.includes(qUp)) {
      symbolContains.push(e);
    }
  }

  // Sort symbolPrefix by length asc (shorter symbol = closer prefix match)
  symbolPrefix.sort((a, b) => a.s.length - b.s.length || a.s.localeCompare(b.s));
  symbolContains.sort((a, b) => a.s.length - b.s.length || a.s.localeCompare(b.s));
  nameWordPrefix.sort((a, b) => a.n.length - b.n.length);

  for (const e of exact) push(e);
  for (const e of symbolPrefix) {
    if (out.length >= limit) break;
    push(e);
  }
  for (const e of nameWordPrefix) {
    if (out.length >= limit) break;
    push(e);
  }
  for (const e of symbolContains) {
    if (out.length >= limit) break;
    push(e);
  }

  if (out.length < limit) {
    const fuse = buildFuse(catalog);
    const fuzzy = fuse.search(q, { limit: limit * 2 });
    for (const r of fuzzy) {
      if (out.length >= limit) break;
      push(r.item);
    }
  }

  return out.slice(0, limit);
}
