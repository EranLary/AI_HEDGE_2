"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

import { useNewRunModal } from "@/components/shell/new-run-context";
import { useToast } from "@/components/shell/toast";
import { submitNewRun, InvalidTickerError } from "@/lib/run-submission";

export function NewRunModal() {
  const { isOpen, close } = useNewRunModal();
  const { push } = useToast();
  const [ticker, setTicker] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state when opened
  useEffect(() => {
    if (!isOpen) return;
    setTicker("");
    setError("");
    setSubmitting(false);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  // Lock body scroll
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await submitNewRun(ticker);
      push(`Run started for ${result.ticker}`, "success");
      close();
    } catch (err) {
      if (err instanceof InvalidTickerError) {
        setError(err.message);
      } else {
        setError(String((err as Error)?.message || err));
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-24 sm:pt-32" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={close} aria-hidden />
      <div className="hib-modal-surface relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/95 p-5 shadow-2xl shadow-black/50">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="hib-modal-close absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
        >
          <X size={14} />
        </button>
        <header className="mb-4">
          <h2 className="font-display text-lg text-zinc-100">Run a new analysis</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--text-muted)]">~30 minutes. Track progress in the sidebar.</p>
        </header>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            ref={inputRef}
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="Ticker (e.g., NVDA)"
            maxLength={10}
            disabled={submitting}
            className="hib-modal-input w-full rounded-xl border border-white/15 bg-black/35 px-4 py-3 text-lg uppercase tracking-[0.08em] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-400/60"
          />
          {error ? (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">{error}</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.14em] text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="hib-run-btn inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/60 bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {submitting ? "Starting..." : "Run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
