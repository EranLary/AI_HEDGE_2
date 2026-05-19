"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

import {
  loadTickerCatalog,
  searchCatalog,
  type TickerEntry,
} from "@/lib/ticker-catalog";

type Props = {
  value: TickerEntry | null;
  onChange: (entry: TickerEntry | null) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

function uppercase(s: string): string {
  return s.toUpperCase();
}

function dedupeBySymbol(entries: TickerEntry[]): TickerEntry[] {
  const seen = new Set<string>();
  const out: TickerEntry[] = [];
  for (const e of entries) {
    const key = e.s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

type SuggestionItem =
  | { kind: "entry"; entry: TickerEntry }
  | { kind: "freeText"; symbol: string };

export function TickerSearch({ value, onChange, disabled, autoFocus }: Props) {
  const [catalog, setCatalog] = useState<TickerEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [remoteResults, setRemoteResults] = useState<TickerEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const remoteAbort = useRef<AbortController | null>(null);

  // Lazy-load the catalog once
  useEffect(() => {
    let cancelled = false;
    loadTickerCatalog().then((c) => {
      if (!cancelled) setCatalog(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const localResults = useMemo<TickerEntry[]>(() => {
    if (!catalog || !query.trim()) return [];
    return searchCatalog(catalog, query, 8);
  }, [catalog, query]);

  // Debounced server-side fallback when local results are sparse
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setRemoteResults([]);
      setRemoteLoading(false);
      return;
    }
    // If local already returned a strong set, skip the network call
    if (localResults.length >= 3) {
      setRemoteResults([]);
      return;
    }
    setRemoteLoading(true);
    const ctrl = new AbortController();
    remoteAbort.current?.abort();
    remoteAbort.current = ctrl;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ticker-search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { results?: TickerEntry[] };
        setRemoteResults(Array.isArray(json.results) ? json.results : []);
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setRemoteResults([]);
        }
      } finally {
        setRemoteLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, localResults.length]);

  const merged = useMemo(() => {
    return dedupeBySymbol([...localResults, ...remoteResults]).slice(0, 10);
  }, [localResults, remoteResults]);

  const normalizedQuery = query.trim().toUpperCase();
  const hasExactSuggestion = useMemo(
    () => merged.some((entry) => entry.s.toUpperCase() === normalizedQuery),
    [merged, normalizedQuery],
  );
  const canUseFreeText = Boolean(normalizedQuery) && TICKER_RE.test(normalizedQuery) && !hasExactSuggestion;
  const suggestionItems = useMemo<SuggestionItem[]>(
    () => [
      ...merged.map((entry) => ({ kind: "entry", entry }) as SuggestionItem),
      ...(canUseFreeText ? [{ kind: "freeText", symbol: normalizedQuery } as SuggestionItem] : []),
    ],
    [merged, canUseFreeText, normalizedQuery],
  );

  // Reset highlight when the merged list changes
  useEffect(() => {
    setHighlight(0);
  }, [suggestionItems.length, query]);

  function pick(entry: TickerEntry) {
    onChange(entry);
    setQuery("");
    setOpen(false);
  }

  function pickFreeText(): TickerEntry | null {
    const raw = query.trim().toUpperCase();
    if (!TICKER_RE.test(raw)) return null;
    const fallback: TickerEntry = { s: raw, n: raw, e: "—", t: "stock" };
    onChange(fallback);
    setQuery("");
    setOpen(false);
    return fallback;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(0, suggestionItems.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selectedItem = suggestionItems[highlight];
      if (selectedItem?.kind === "entry") {
        pick(selectedItem.entry);
      } else if (selectedItem?.kind === "freeText") {
        pickFreeText();
      } else if (query.trim()) {
        pickFreeText();
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  // When a value is committed, the input shows nothing and we render a chip below.
  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(uppercase(e.target.value));
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value ? value.s : "Search ticker or company (e.g. NVDA, Apple)"}
          maxLength={64}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          className="hib-modal-input w-full rounded-xl border border-white/15 bg-black/35 py-3 pl-9 pr-9 text-base tracking-[0.04em] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-400/60"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            aria-label="Clear"
          >
            <X size={14} />
          </button>
        ) : remoteLoading ? (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-500" />
        ) : null}
      </div>

      {value ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold tracking-[0.06em] text-emerald-200">{value.s}</span>
              <span className="hib-chip-exchange rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                {value.e || "—"}
              </span>
              {value.t && value.t !== "stock" ? (
                <span className="hib-chip-etf rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                  {value.t}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-zinc-300">{value.n}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300 hover:bg-white/10"
          >
            Change
          </button>
        </div>
      ) : null}

      {open && !value && query ? (
        <div className="hib-auth-menu absolute left-0 right-0 top-full z-50 mt-1 rounded-xl p-1.5 shadow-xl">
          {suggestionItems.length ? (
            <ul className="max-h-[280px] overflow-auto" role="listbox">
              {suggestionItems.map((item, i) => {
                const isHi = i === highlight;
                if (item.kind === "freeText") {
                  return (
                    <li key={`free-text-${item.symbol}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isHi}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => pickFreeText()}
                        className={`hib-auth-menu-item flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left ${
                          isHi ? "bg-emerald-500/15" : ""
                        }`}
                      >
                        <span className="truncate text-xs text-zinc-300">
                          Use <span className="font-mono text-sm font-semibold text-zinc-100">{item.symbol}</span> anyway
                        </span>
                      </button>
                    </li>
                  );
                }
                const entry = item.entry;
                return (
                  <li key={`${entry.s}-${i}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHi}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(entry)}
                      className={`hib-auth-menu-item flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left ${
                        isHi ? "bg-emerald-500/15" : ""
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="font-mono text-sm font-semibold tracking-[0.06em]">{entry.s}</span>
                        <span className="truncate text-xs text-zinc-400">{entry.n}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {entry.t && entry.t !== "stock" ? (
                          <span className="hib-chip-etf rounded border px-1 py-0.5 text-[9px] uppercase tracking-[0.1em]">
                            {entry.t}
                          </span>
                        ) : null}
                        <span className="hib-chip-exchange rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em]">
                          {entry.e || "—"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-3 py-3 text-xs text-zinc-500">
              {catalog === null ? "Loading tickers..." : "No matches yet."}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
