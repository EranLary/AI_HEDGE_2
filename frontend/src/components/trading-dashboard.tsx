"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useWorkspace } from "@/components/shell/workspace-context";
import type { TradingDashboardPayload } from "@/lib/trading-types";

type PairingResult = {
  connection_id: string;
  code: string;
  expires_at: string;
};

type StrategyPreview = {
  preview_id: string;
  expires_at: string;
  preview: {
    current: { portfolio_key: string; budget_usd: number } | null;
    target: {
      portfolio_key: string;
      label: string;
      snapshot_id: string;
      cutoff_at: string;
      execution_date: string;
      budget_usd: number;
      investable_budget_usd: number;
      holdings_count: number;
      eligible: boolean;
      eligibility_reasons: string[];
    };
    estimated_changes: { additions: string[]; removals: string[] };
    safeguards: string[];
  };
};

function displayDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(new Date(value));
}

function nextMonthlyCutoff(value: string | null | undefined): string {
  if (!value) return "After the next monthly refresh";
  const date = new Date(value);
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0));
  return displayDate(next.toISOString().slice(0, 10));
}

function statusTone(status: string): string {
  if (["ready", "armed", "completed", "filled"].includes(status)) return "text-[color:var(--success)]";
  if (["error", "blocked", "rejected", "partial"].includes(status)) return "text-[color:var(--danger)]";
  if (["paused", "disconnected", "awaiting_pairing"].includes(status)) return "text-[color:var(--warning)]";
  return "text-[color:var(--text-secondary)]";
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function TradingDashboard() {
  const { workspace, api } = useWorkspace();
  const searchParams = useSearchParams();
  const requestedPortfolio = searchParams.get("portfolio") || "";
  const [data, setData] = useState<TradingDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [preview, setPreview] = useState<StrategyPreview | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [portfolioKey, setPortfolioKey] = useState(requestedPortfolio);
  const [budget, setBudget] = useState("1000");

  const load = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(api("/api/trading"), { cache: "no-store" });
      const payload = await response.json() as TradingDashboardPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load trading controls.");
      setData(payload);
      const paired = payload.connections.find((connection) => connection.status !== "awaiting_pairing");
      setConnectionId((current) => current || paired?.id || "");
      if (payload.strategy) {
        setBudget(String(payload.strategy.budget_usd));
        const linked = payload.portfolios.find((portfolio) => (
          portfolio.lens_type === payload.strategy?.lens_type
          && portfolio.lens_key === payload.strategy?.lens_key
          && portfolio.methodology_version === payload.strategy?.methodology_version
        ));
        setPortfolioKey((current) => current || linked?.portfolio_key || "");
      } else {
        setPortfolioKey((current) => current || requestedPortfolio || payload.portfolios[0]?.portfolio_key || "");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load trading controls.");
    } finally {
      setLoading(false);
    }
  }, [api, requestedPortfolio]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, workspace]);

  const selectedPortfolio = useMemo(
    () => data?.portfolios.find((portfolio) => portfolio.portfolio_key === portfolioKey) || null,
    [data?.portfolios, portfolioKey],
  );
  const selectedConnection = data?.connections.find((connection) => connection.id === connectionId) || null;
  const strategyPortfolio = data?.strategy
    ? data.portfolios.find((portfolio) => (
      portfolio.lens_type === data.strategy?.lens_type
      && portfolio.lens_key === data.strategy?.lens_key
      && portfolio.methodology_version === data.strategy?.methodology_version
    )) || null
    : null;
  const actualBySymbol = new Map((data?.positions || []).map((position) => [position.symbol, position]));

  async function createPairing() {
    if (selectedConnection && !window.confirm("Rotate this connection's device secret? The current executor will stop authenticating immediately.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/trading/pairing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection_id: selectedConnection?.id || null }),
      });
      const payload = await response.json() as PairingResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not create pairing code.");
      setPairing(payload);
      setConnectionId(payload.connection_id);
      setNotice("Pairing code created. Enter it once on the Windows executor VM.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Pairing failed.");
    } finally { setBusy(false); }
  }

  async function requestPreview() {
    if (!selectedPortfolio || !connectionId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/trading/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connection_id: connectionId,
          workspace,
          lens_type: selectedPortfolio.lens_type,
          lens_key: selectedPortfolio.lens_key,
          methodology_version: selectedPortfolio.methodology_version,
          budget_usd: Number(budget),
          arm: true,
        }),
      });
      const payload = await response.json() as StrategyPreview & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not prepare strategy preview.");
      setPreview(payload);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Preview failed.");
    } finally { setBusy(false); }
  }

  async function confirmPreview() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/trading/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preview_id: preview.preview_id }),
      });
      const payload = await response.json() as { reason?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not confirm strategy.");
      setPreview(null);
      setNotice(payload.reason || "Paper strategy updated.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Confirmation failed.");
    } finally { setBusy(false); }
  }

  async function control(action: "pause" | "resume" | "kill_switch") {
    if (!selectedConnection) return;
    if (action === "kill_switch" && !window.confirm("Cancel all open system orders and pause trading? Existing holdings will not be sold.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/trading/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection_id: selectedConnection.id, action }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Control action failed.");
      setNotice(action === "kill_switch" ? "Kill switch requested. Holdings were left intact." : `Trading ${action} requested.`);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Control action failed.");
    } finally { setBusy(false); }
  }

  if (loading && !data) {
    return <div className="mx-auto w-full max-w-[1500px] p-6 text-sm text-[color:var(--text-muted)]">Loading trading controls...</div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-6 text-[color:var(--text-primary)] sm:px-8">
      <header className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-overlay)] p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">IBKR automation</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl">Trading</h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[color:var(--text-muted)]">
              Connect one frozen Portfolio Returns strategy to an IBKR Paper account. Research returns remain separate from real fills, fees, and execution lag.
            </p>
          </div>
          <span className="rounded-full border border-[color:var(--warning)] px-3 py-1 text-xs font-semibold text-[color:var(--warning)]">
            Paper only · Live locked
          </span>
        </div>
        {!data?.enabled ? (
          <p className="mt-4 rounded-lg border border-[color:var(--warning)] bg-[color:var(--surface)] p-3 text-sm text-[color:var(--warning)]">
            Trading mutations are disabled in this environment. Preview builds expose the UI and portfolio data only.
          </p>
        ) : null}
        {workspace === "analysis" ? (
          <p className="mt-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3 text-sm text-[color:var(--text-muted)]">
            Analysis portfolios are visible for planning but execution is disabled until contract, market-hours, and explicit FX mapping are complete. Nasdaq 100 is the first executable universe.
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-[color:var(--danger)]">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm text-[color:var(--success)]">{notice}</p> : null}
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="1. Paper connection">
          {data?.connections.length ? (
            <select value={connectionId} onChange={(event) => setConnectionId(event.target.value)} className="w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-primary)]">
              {data.connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.account_masked || "Awaiting VM"} · {connection.mode}</option>)}
            </select>
          ) : <p className="text-sm text-[color:var(--text-muted)]">No IBKR executor is paired.</p>}
          {selectedConnection ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-[color:var(--text-muted)]">Status</dt><dd className={`mt-1 font-semibold ${statusTone(selectedConnection.status)}`}>{selectedConnection.status}</dd></div>
              <div><dt className="text-[color:var(--text-muted)]">Gateway</dt><dd className={`mt-1 font-semibold ${selectedConnection.gateway_authenticated ? "text-[color:var(--success)]" : "text-[color:var(--warning)]"}`}>{selectedConnection.gateway_authenticated ? "Authenticated" : "Offline"}</dd></div>
              <div><dt className="text-[color:var(--text-muted)]">IBKR account structure</dt><dd className="mt-1 font-semibold text-[color:var(--text-primary)]">{selectedConnection.account_type}</dd></div>
              <div className="col-span-2"><dt className="text-[color:var(--text-muted)]">Last heartbeat</dt><dd className="mt-1 text-[color:var(--text-primary)]">{displayDate(selectedConnection.last_heartbeat_at)}</dd></div>
            </dl>
          ) : null}
          <button type="button" onClick={createPairing} disabled={busy || !data?.enabled} className="mt-4 rounded-lg border border-[color:var(--accent)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)]">
            {selectedConnection ? "Rotate executor pairing" : "Create Paper pairing code"}
          </button>
          <button type="button" onClick={() => { void load(); }} disabled={busy || loading} className="ml-2 mt-4 rounded-lg border border-[color:var(--border-strong)] px-3 py-2 text-xs font-semibold text-[color:var(--text-secondary)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)]">
            Refresh status
          </button>
          {pairing ? (
            <div className="mt-3 rounded-lg border border-[color:var(--accent)] bg-[color:var(--surface)] p-3">
              <p className="font-mono text-xl font-bold tracking-[0.18em] text-[color:var(--accent)]">{pairing.code}</p>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">Expires {displayDate(pairing.expires_at)}. It is shown only in this session.</p>
            </div>
          ) : null}
        </Card>

        <Card title="2. Portfolio and budget">
          <label className="text-xs font-medium text-[color:var(--text-secondary)]" htmlFor="trading-portfolio">Paper portfolio</label>
          <select id="trading-portfolio" value={portfolioKey} onChange={(event) => { setPortfolioKey(event.target.value); setPreview(null); }} className="mt-1 w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-primary)]">
            <option value="">Select portfolio</option>
            {(data?.portfolios || []).map((portfolio) => <option key={portfolio.portfolio_key} value={portfolio.portfolio_key}>{portfolio.label} · {portfolio.holdings_count} holdings</option>)}
          </select>
          <label className="mt-3 block text-xs font-medium text-[color:var(--text-secondary)]" htmlFor="trading-budget">Fixed USD budget</label>
          <input id="trading-budget" type="number" min="100" step="100" value={budget} onChange={(event) => { setBudget(event.target.value); setPreview(null); }} className="mt-1 w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-primary)]" />
          <p className="mt-2 text-xs text-[color:var(--text-muted)]">Up to 98% invested; 2% remains for fees and price movement. The executor requires full N/N target coverage and never borrows on margin or counts unsettled sale proceeds.</p>
          {data?.strategy ? <p className="mt-2 text-xs text-[color:var(--text-muted)]">Strategy-owned cash ledger: <span className="font-semibold text-[color:var(--text-primary)]">${data.strategy.cash_balance_usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>. Other account cash is excluded from sizing.</p> : null}
          {selectedPortfolio ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-[color:var(--text-muted)]">Snapshot</dt><dd className="mt-1 font-mono text-[color:var(--text-primary)]">{selectedPortfolio.latest_snapshot_id.slice(0, 8)}</dd></div>
              <div><dt className="text-[color:var(--text-muted)]">Execution session</dt><dd className="mt-1 text-[color:var(--text-primary)]">{selectedPortfolio.execution_date}</dd></div>
              <div><dt className="text-[color:var(--text-muted)]">Next cutoff</dt><dd className="mt-1 text-[color:var(--text-primary)]">{nextMonthlyCutoff(selectedPortfolio.cutoff_at)}</dd></div>
              <div><dt className="text-[color:var(--text-muted)]">Order window</dt><dd className="mt-1 text-[color:var(--text-primary)]">10:00 New York</dd></div>
            </dl>
          ) : null}
          <button type="button" onClick={requestPreview} disabled={busy || !data?.enabled || workspace !== "nasdaq100" || !selectedPortfolio || !connectionId || Number(budget) < 100} className="mt-4 rounded-lg bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-on-accent)] disabled:cursor-not-allowed disabled:bg-[color:var(--surface)] disabled:text-[color:var(--text-disabled)]">
            Review and arm Paper
          </button>
        </Card>

        <Card title="3. Safety controls">
          <p className="text-sm text-[color:var(--text-muted)]">Pause leaves holdings and orders untouched. Kill switch pauses and asks the executor to cancel system-owned open orders; it never liquidates automatically.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {selectedConnection?.status === "paused" ? (
              <button type="button" onClick={() => control("resume")} disabled={busy || !data?.enabled} className="rounded-lg border border-[color:var(--success)] px-3 py-2 text-xs font-semibold text-[color:var(--success)] disabled:text-[color:var(--text-disabled)]">Resume</button>
            ) : (
              <button type="button" onClick={() => control("pause")} disabled={busy || !data?.enabled || !selectedConnection} className="rounded-lg border border-[color:var(--warning)] px-3 py-2 text-xs font-semibold text-[color:var(--warning)] disabled:text-[color:var(--text-disabled)]">Pause</button>
            )}
            <button type="button" onClick={() => control("kill_switch")} disabled={busy || !data?.enabled || !selectedConnection} className="rounded-lg border border-[color:var(--danger)] px-3 py-2 text-xs font-semibold text-[color:var(--danger)] disabled:text-[color:var(--text-disabled)]">Kill switch</button>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[color:var(--text-muted)]">An empty target is blocked and requires a separate future liquidation flow. This screen does not expose liquidation.</p>
        </Card>
      </div>

      {preview ? (
        <Card title="Confirmation preview">
          <div className="grid gap-4 lg:grid-cols-3">
            <dl className="space-y-2 text-sm"><div><dt className="text-[color:var(--text-muted)]">Target</dt><dd className="font-semibold">{preview.preview.target.label}</dd></div><div><dt className="text-[color:var(--text-muted)]">Budget / investable</dt><dd>${preview.preview.target.budget_usd.toLocaleString()} / ${preview.preview.target.investable_budget_usd.toLocaleString()}</dd></div><div><dt className="text-[color:var(--text-muted)]">Eligibility</dt><dd className={preview.preview.target.eligible ? "text-[color:var(--success)]" : "text-[color:var(--danger)]"}>{preview.preview.target.eligible ? "Eligible" : preview.preview.target.eligibility_reasons.join(", ")}</dd></div></dl>
            <div className="text-sm"><p className="text-[color:var(--text-muted)]">Estimated symbol changes</p><p className="mt-2 text-[color:var(--success)]">Add: {preview.preview.estimated_changes.additions.join(", ") || "None"}</p><p className="mt-1 text-[color:var(--danger)]">Remove: {preview.preview.estimated_changes.removals.join(", ") || "None"}</p></div>
            <ul className="space-y-1 text-xs text-[color:var(--text-muted)]">{preview.preview.safeguards.map((item) => <li key={item}>· {item}</li>)}</ul>
          </div>
          <div className="mt-4 flex gap-2"><button type="button" onClick={confirmPreview} disabled={busy || !preview.preview.target.eligible} className="rounded-lg bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold text-[color:var(--text-on-accent)] disabled:bg-[color:var(--surface)] disabled:text-[color:var(--text-disabled)]">Confirm Paper automation</button><button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-[color:var(--border-strong)] px-3 py-2 text-xs text-[color:var(--text-secondary)]">Cancel</button></div>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Target versus strategy-owned positions">
          <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead className="text-left text-xs text-[color:var(--text-muted)]"><tr><th className="pb-2">Symbol</th><th className="pb-2 text-right">Target weight</th><th className="pb-2 text-right">Owned quantity</th><th className="pb-2 text-right">Average cost</th></tr></thead><tbody>{(strategyPortfolio?.holdings || []).map((holding) => { const actual = actualBySymbol.get(holding.ticker); return <tr key={holding.ticker} className="border-t border-[color:var(--border-subtle)]"><td className="py-2 font-semibold">{holding.ticker}</td><td className="py-2 text-right">{(holding.weight * 100).toFixed(2)}%</td><td className="py-2 text-right">{actual?.quantity ?? "—"}</td><td className="py-2 text-right">{actual?.average_cost_usd == null ? "—" : `$${actual.average_cost_usd.toFixed(2)}`}</td></tr>; })}</tbody></table></div>
          {!strategyPortfolio ? <p className="text-sm text-[color:var(--text-muted)]">No portfolio is armed yet.</p> : null}
        </Card>
        <Card title="Rebalance plans">
          <div className="space-y-2">{(data?.plans || []).map((plan) => <div key={plan.id} className="flex items-start justify-between gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3 text-sm"><div><p className="font-mono text-xs">{plan.snapshot_id.slice(0, 8)}</p><p className="mt-1 text-xs text-[color:var(--text-muted)]">{plan.target_holdings.length} targets · coverage {String(plan.preflight.target_coverage || `pending/${plan.target_holdings.length}`)} · {displayDate(plan.created_at)}</p>{plan.preflight.minimum_budget_usd ? <p className="mt-1 text-xs text-[color:var(--text-muted)]">Estimated minimum full-coverage budget: ${String(plan.preflight.minimum_budget_usd)}</p> : null}{plan.error ? <p className="mt-1 text-xs text-[color:var(--danger)]">{plan.error}</p> : null}</div><span className={`font-semibold ${statusTone(plan.status)}`}>{plan.status}</span></div>)}{!data?.plans.length ? <p className="text-sm text-[color:var(--text-muted)]">No rebalance plans yet.</p> : null}</div>
        </Card>
        <Card title="Orders">
          <div className="space-y-2">{(data?.orders || []).map((order) => <div key={order.id} className="grid grid-cols-[auto_1fr_auto] gap-3 border-b border-[color:var(--border-subtle)] pb-2 text-sm"><span className={order.side === "BUY" ? "text-[color:var(--success)]" : "text-[color:var(--warning)]"}>{order.side}</span><span>{order.symbol} · {order.filled_quantity}/{order.requested_quantity}</span><span className={statusTone(order.status)}>{order.status}</span></div>)}{!data?.orders.length ? <p className="text-sm text-[color:var(--text-muted)]">No system orders yet.</p> : null}</div>
        </Card>
        <Card title="Fills, fees, and alerts">
          <div className="space-y-2">{(data?.fills || []).slice(0, 8).map((fill) => <p key={fill.exec_id} className="text-sm"><span className="font-semibold">{fill.side} {fill.symbol}</span> · {fill.quantity} @ ${fill.price.toFixed(2)} · fee {fill.commission.toFixed(2)} {fill.commission_currency}</p>)}{(data?.events || []).slice(0, 8).map((event) => <p key={`${event.created_at}:${event.event_type}`} className={`border-t border-[color:var(--border-subtle)] pt-2 text-xs ${statusTone(event.severity === "critical" ? "error" : event.severity)}`}>{event.event_type}: {event.message}</p>)}{!data?.fills.length && !data?.events.length ? <p className="text-sm text-[color:var(--text-muted)]">No fills or alerts yet.</p> : null}</div>
        </Card>
      </div>
    </div>
  );
}
