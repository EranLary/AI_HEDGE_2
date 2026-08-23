"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, LockKeyhole, Search, X } from "lucide-react";

type UniverseStock = { ticker: string; companyName: string; rank: number | null };
type UniverseSnapshot = {
  source: string;
  sourceUrl: string | null;
  asOf: string | null;
  stocks: UniverseStock[];
};

export type NasdaqRunSummary = {
  id: string;
  releaseId: string;
  requestedMode: "all" | "selected" | "missing_week";
  effectiveMode: "all" | "selected" | "missing_week" | "resume_week";
  status: "queued" | "running" | "completed" | "partial" | "failed" | "stopped";
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  stoppedCount: number;
  stoppedBeforeStartCount: number;
  stoppedAfterAttemptCount: number;
  retryPendingCount: number;
  activeCount: number;
  leadingTicker: string;
  leadingProgressPct: number;
  concurrency: number;
  estimatedCostPerAttemptUsd: number;
  estimatedCostUsd: number;
  observedCostUsd: number;
  budgetLimitUsd: number;
  stopRequestedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string;
};

export type NasdaqRunsResponse = {
  isAdmin: boolean;
  authorized: boolean;
  runs: NasdaqRunSummary[];
  universe?: UniverseSnapshot | null;
  executionWindow?: { open: boolean; enforced: boolean; label: string };
  error?: string;
};

type RunMode = "all" | "selected" | "missing_week";

const MODE_OPTIONS: Array<{ mode: RunMode; title: string; description: string }> = [
  {
    mode: "all",
    title: "Run full universe",
    description: "Run every stock. If the latest full-universe run was interrupted within seven days, continue only its missing stocks.",
  },
  {
    mode: "selected",
    title: "Run selected stocks",
    description: "Choose one or more companies from the current Nasdaq 100 universe.",
  },
  {
    mode: "missing_week",
    title: "Run stocks not analyzed in the last 7 days",
    description: "Skip every Nasdaq 100 stock with a completed report in the last seven days.",
  },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}

export function NasdaqRunModal({
  open,
  onClose,
  initialData,
  onData,
}: {
  open: boolean;
  onClose: () => void;
  initialData: NasdaqRunsResponse | null;
  onData: (data: NasdaqRunsResponse) => void;
}) {
  const [loadedData, setLoadedData] = useState<NasdaqRunsResponse | null>(null);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<RunMode>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/nasdaq100/runs", { cache: "no-store" });
    const payload = await response.json() as NasdaqRunsResponse;
    setLoadedData(payload);
    onData(payload);
    if (!response.ok && payload.error) setError(payload.error);
    return payload;
  }, [onData]);

  const data = loadedData ?? initialData;

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);

  useEffect(() => {
    if (!open || !data?.runs?.some((run) => run.status === "queued" || run.status === "running")) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [data?.runs, open, refresh]);

  const stocks = useMemo(() => data?.universe?.stocks || [], [data?.universe?.stocks]);
  const visibleStocks = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return stocks;
    return stocks.filter((stock) => stock.ticker.toLowerCase().includes(clean)
      || stock.companyName.toLowerCase().includes(clean));
  }, [query, stocks]);
  const liveRun = data?.runs?.find((run) => run.status === "queued" || run.status === "running") || null;
  const latestRun = data?.runs?.[0] || null;

  const authorize = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/nasdaq100/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Authorization failed.");
      setPassword("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authorization failed.");
    } finally {
      setBusy(false);
    }
  };

  const startRun = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/nasdaq100/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, tickers: mode === "selected" ? Array.from(selected) : [] }),
      });
      const payload = await response.json() as { error?: string; resumed?: boolean; run?: NasdaqRunSummary };
      if (!response.ok) throw new Error(payload.error || "Failed to start the universe run.");
      setNotice(payload.resumed
        ? "Resuming the interrupted release. Only missing stocks were queued."
        : `${payload.run?.requestedCount || 0} stocks were queued.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to start the universe run.");
    } finally {
      setBusy(false);
    }
  };

  const stopRun = async () => {
    if (!liveRun) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/nasdaq100/runs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: liveRun.id }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to stop the universe run.");
      setNotice("Stop requested. Active stocks will finish; no new stocks will start.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to stop the universe run.");
    } finally {
      setBusy(false);
    }
  };

  const toggleTicker = (ticker: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const closeModal = () => {
    setError("");
    setNotice("");
    setPassword("");
    setLoadedData(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="nasdaq-run-title">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--surface-elevated)] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border-subtle)] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Administrator</p>
            <h2 id="nasdaq-run-title" className="mt-1 text-xl font-semibold text-[color:var(--text-primary)]">Run Nasdaq 100 universe</h2>
          </div>
          <button type="button" onClick={closeModal} aria-label="Close" className="rounded-lg p-2 text-[color:var(--text-muted)] hover:bg-white/5 hover:text-[color:var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {error ? <div className="mb-4 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-[color:var(--danger)]">{error}</div> : null}
          {notice ? <div className="mb-4 rounded-lg border border-[color:var(--accent)] bg-emerald-500/10 px-3 py-2 text-sm text-[color:var(--success)]">{notice}</div> : null}

          {!data?.authorized ? (
            <form onSubmit={authorize} className="mx-auto max-w-md space-y-4 py-6">
              <div className="flex justify-center"><LockKeyhole size={28} className="text-[color:var(--accent)]" /></div>
              <div className="text-center">
                <h3 className="font-semibold text-[color:var(--text-primary)]">Confirm universe-run access</h3>
                <p className="mt-1 text-sm text-[color:var(--text-muted)]">Enter the administrator run password. Access expires after ten minutes.</p>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  className="w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !password}
                className="w-full rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--text-on-accent)] hover:bg-[color:var(--accent-hover)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
              >
                {busy ? "Checking…" : "Continue"}
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                {MODE_OPTIONS.map((option) => {
                  const active = mode === option.mode;
                  return (
                    <button
                      type="button"
                      key={option.mode}
                      onClick={() => setMode(option.mode)}
                      className={`rounded-xl border p-3 text-left transition ${active
                        ? "border-[color:var(--accent)] bg-emerald-500/10"
                        : "border-[color:var(--border-subtle)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)]"}`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-[color:var(--text-primary)]">
                        <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active ? "border-[color:var(--accent)] text-[color:var(--accent)]" : "border-[color:var(--border-strong)]"}`}>
                          {active ? <Check size={11} /> : null}
                        </span>
                        {option.title}
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-[color:var(--text-muted)]">{option.description}</span>
                    </button>
                  );
                })}
              </div>

              {mode === "selected" ? (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)]">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border-subtle)] p-3">
                    <label className="relative min-w-52 flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search ticker or company"
                        className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] py-2 pl-9 pr-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
                      />
                    </label>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-[color:var(--text-muted)]">{selected.size} selected</span>
                      <button type="button" onClick={() => setSelected(new Set(stocks.map((stock) => stock.ticker)))} className="text-[color:var(--accent)] hover:text-[color:var(--accent-hover)]">Select all</button>
                      <button type="button" onClick={() => setSelected(new Set())} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">Clear</button>
                    </div>
                  </div>
                  <div className="grid max-h-64 gap-px overflow-y-auto sm:grid-cols-2">
                    {visibleStocks.map((stock) => (
                      <label key={stock.ticker} className="flex cursor-pointer items-center gap-3 border-b border-[color:var(--border-subtle)] px-3 py-2 hover:bg-white/5">
                        <input type="checkbox" checked={selected.has(stock.ticker)} onChange={() => toggleTicker(stock.ticker)} className="accent-[color:var(--accent)]" />
                        <span className="min-w-0">
                          <strong className="text-sm text-[color:var(--text-primary)]">{stock.ticker}</strong>
                          <span className="ml-2 text-xs text-[color:var(--text-muted)]">{stock.companyName}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--text-secondary)]">
                <p>Each ticker is attempted up to 3 times. A completed report is published immediately, even if the wider run later stops.</p>
                <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                  Execution window: {data.executionWindow?.label || "10:00-01:00 UTC"}
                  {data.executionWindow?.enforced
                    ? (data.executionWindow.open ? " · open now" : " · currently closed")
                    : " · enforcement disabled"}
                </p>
                <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                  Universe: {stocks.length} companies · {data.universe?.source || "Unknown source"} · as of {formatDate(data.universe?.asOf)}
                </p>
              </div>

              {latestRun ? (
                <div className="rounded-xl border border-[color:var(--border-subtle)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-[color:var(--text-primary)]">Latest run · {latestRun.status}</strong>
                    <span className="text-xs text-[color:var(--text-muted)]">{formatDate(latestRun.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
                    {latestRun.completedCount}/{latestRun.requestedCount} completed
                    {latestRun.activeCount ? ` · ${latestRun.activeCount} active` : ""}
                    {latestRun.failedCount ? ` · ${latestRun.failedCount} failed` : ""}
                    {latestRun.effectiveMode === "resume_week" ? " · seven-day resume" : ""}
                  </p>
                  <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                    {latestRun.concurrency} workers · ${latestRun.estimatedCostUsd.toFixed(2)} planned
                    {latestRun.observedCostUsd > 0 ? ` · $${latestRun.observedCostUsd.toFixed(2)} observed` : ""}
                    {` · $${latestRun.budgetLimitUsd.toFixed(0)} limit`}
                  </p>
                  {latestRun.retryPendingCount || latestRun.stoppedCount ? (
                    <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                      {latestRun.retryPendingCount ? `${latestRun.retryPendingCount} waiting to retry` : ""}
                      {latestRun.retryPendingCount && latestRun.stoppedBeforeStartCount ? " / " : ""}
                      {latestRun.stoppedBeforeStartCount ? `${latestRun.stoppedBeforeStartCount} not started` : ""}
                      {(latestRun.retryPendingCount || latestRun.stoppedBeforeStartCount) && latestRun.stoppedAfterAttemptCount ? " / " : ""}
                      {latestRun.stoppedAfterAttemptCount ? `${latestRun.stoppedAfterAttemptCount} stopped before retry` : ""}
                    </p>
                  ) : null}
                  {latestRun.stopRequestedAt && (latestRun.status === "queued" || latestRun.status === "running") ? (
                    <p className="mt-2 text-xs text-[color:var(--warning)]">Stop requested. Active stocks are finishing.</p>
                  ) : null}
                  {latestRun.error ? (
                    <p className={`mt-2 text-xs ${latestRun.status === "stopped" ? "text-[color:var(--warning)]" : "text-[color:var(--danger)]"}`}>
                      {latestRun.error}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
                <button type="button" onClick={closeModal} className="rounded-lg border border-[color:var(--border-strong)] px-4 py-2 text-sm text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]">Close</button>
                {liveRun && !liveRun.stopRequestedAt ? (
                  <button
                    type="button"
                    onClick={stopRun}
                    disabled={busy}
                    className="rounded-lg border border-[color:var(--danger)] px-4 py-2 text-sm font-semibold text-[color:var(--danger)] hover:bg-[color:var(--surface-elevated)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
                  >
                    Stop after active stocks
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={startRun}
                  disabled={busy || Boolean(liveRun) || (mode === "selected" && selected.size === 0)
                    || Boolean(data.executionWindow?.enforced && !data.executionWindow.open)}
                  className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--text-on-accent)] hover:bg-[color:var(--accent-hover)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
                >
                  {busy ? "Starting…" : liveRun ? "Run in progress"
                    : data.executionWindow?.enforced && !data.executionWindow.open ? "Off-peak window closed"
                      : "Start run"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
