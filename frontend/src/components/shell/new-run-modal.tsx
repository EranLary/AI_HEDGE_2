"use client";

import { useEffect, useState } from "react";
import { Loader2, Play, X } from "lucide-react";
import { signIn, useSession } from "next-auth/react";

import { useNewRunModal } from "@/components/shell/new-run-context";
import { useToast } from "@/components/shell/toast";
import { TickerSearch } from "@/components/shell/ticker-search";
import {
  submitNewRun,
  InvalidTickerError,
  SignInRequiredForRunError,
  TickerNotFoundError,
} from "@/lib/run-submission";
import type { TickerEntry } from "@/lib/ticker-catalog";

export function NewRunModal() {
  const { isOpen, close } = useNewRunModal();
  const { push } = useToast();
  const { data: session } = useSession();
  const [selected, setSelected] = useState<TickerEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isGuest = Boolean(session?.user?.isGuest);

  // Reset state when opened
  useEffect(() => {
    if (!isOpen) return;
    setSelected(null);
    setError("");
    setSubmitting(false);
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
    if (submitting || !selected) return;
    if (isGuest) {
      setError("Please sign in with Google before running a new analysis.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const result = await submitNewRun(selected.s);
      push(`Run started for ${result.ticker}`, "success");
      close();
    } catch (err) {
      if (err instanceof TickerNotFoundError) {
        setError(`${err.message} Double-check the symbol or try a different ticker.`);
      } else if (err instanceof SignInRequiredForRunError) {
        setError(err.message);
      } else if (err instanceof InvalidTickerError) {
        setError(err.message);
      } else {
        setError(String((err as Error)?.message || err));
      }
      setSubmitting(false);
    }
  }

  const isEtf = selected?.t === "etf";
  const canRun = !!selected && !submitting && !isEtf;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-20 sm:pt-28" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={close} aria-hidden />
      <div className="hib-modal-surface relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950/95 p-6 shadow-2xl shadow-black/50">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="hib-modal-close absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
        >
          <X size={14} />
        </button>
        <header className="mb-5">
          <h2 className="font-display text-xl text-zinc-100">Run a new analysis</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
            Search by ticker or company &middot; ~30 minutes &middot; track in sidebar
          </p>
        </header>
        <form onSubmit={onSubmit} className="space-y-4">
          <TickerSearch
            value={selected}
            onChange={(entry) => {
              setSelected(entry);
              setError("");
            }}
            disabled={submitting}
            autoFocus
          />
          {isEtf ? (
            <p className="hib-disclaimer-amber rounded-lg border px-3 py-2 text-xs">
              ETF analysis isn&apos;t supported yet. Pick a single-issuer equity instead.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">{error}</p>
          ) : null}
          {isGuest ? (
            <p className="hib-guest-note rounded-lg border px-3 py-2 text-xs">
              Guest accounts can browse everything, but must sign in with Google to run a new analysis.
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            {isGuest ? (
              <button
                type="button"
                onClick={() => signIn("google", { callbackUrl: window.location.pathname + window.location.search })}
                className="rounded-lg border border-emerald-400/60 bg-emerald-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100 hover:bg-emerald-500/25"
              >
                Sign in to run
              </button>
            ) : null}
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
              disabled={!canRun}
              className="hib-run-btn inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/60 bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-50"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {submitting
                ? "Starting..."
                : isEtf
                  ? "ETFs not supported"
                  : selected
                    ? `Run ${selected.s}`
                    : "Pick a ticker"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
