"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Database } from "lucide-react";

import type { DashboardPayload } from "@/lib/dashboard-types";
import {
  finiteShareCount,
  formatCompactShares,
  formatFullShares,
  normalizeShareCountResolution,
  resolvedShareCount,
  shareCountChanged,
  shareCountDelta,
  shareCountPresentation,
} from "@/lib/share-count-display";

function providerCandidateLabel(value: string): string {
  if (value === "current_valuation_denominator") return "Yahoo value used before verification";
  if (value === "provider_implied_shares") return "Yahoo implied shares";
  if (value === "market_cap_div_current_price") return "Market cap divided by share price";
  return "Additional Yahoo estimate";
}

export function ValuationShareCount({ data }: { data: DashboardPayload | null }) {
  const embeddedResolution = data?.header?.share_count_resolution;
  const [historicalResult, setHistoricalResult] = useState<{
    reportId: string;
    resolution: NonNullable<DashboardPayload["header"]["share_count_resolution"]>;
  } | null>(null);
  const historicalResolution =
    historicalResult && historicalResult.reportId === data?.report_id
      ? historicalResult.resolution
      : null;
  const resolution = embeddedResolution || historicalResolution;
  const finalShares = resolvedShareCount(data?.header?.shares_outstanding, resolution);
  const originalShares = finiteShareCount(resolution?.original_yahoo_shares);
  const changed = shareCountChanged(resolution);
  const delta = shareCountDelta(resolution);
  const presentation = shareCountPresentation(resolution);
  const providerCandidates = Object.entries(resolution?.provider_candidates || {}).filter(
    ([, value]) => finiteShareCount(value) !== null,
  );
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (embeddedResolution || !data?.report_id || !data?.ticker) return;
    const reportId = data.report_id;
    const controller = new AbortController();
    const query = new URLSearchParams({
      workspace: data.workspace === "nasdaq100" ? "nasdaq100" : "analysis",
      report_id: reportId,
    });
    fetch(
      `/api/artifacts/${encodeURIComponent(data.ticker)}/share-count-resolution-json?${query.toString()}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) return;
        const next = normalizeShareCountResolution(payload, data.header?.shares_outstanding);
        if (next) setHistoricalResult({ reportId, resolution: next });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [data?.header?.shares_outstanding, data?.report_id, data?.ticker, data?.workspace, embeddedResolution]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (finalShares === null) return null;

  const difference = delta && Math.abs(delta.count) > 0.5
    ? `${delta.count >= 0 ? "+" : "−"}${formatFullShares(Math.abs(delta.count))} (${delta.percent >= 0 ? "+" : ""}${delta.percent.toFixed(2)}%)`
    : "No adjustment";

  return (
    <div ref={containerRef} className="relative h-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-full min-h-16 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition ${
          changed
            ? "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] hover:border-[color:var(--warning)]"
            : "border-[color:var(--border-subtle)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)]"
        }`}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
            <Database size={12} aria-hidden="true" /> Valuation shares
          </span>
          <span className="mt-0.5 block text-sm font-semibold tabular-nums text-[color:var(--text-primary)]">
            {formatCompactShares(finalShares)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`text-[9px] font-semibold uppercase tracking-[0.1em] ${changed ? "text-[color:var(--warning)]" : "text-[color:var(--text-muted)]"}`}>
            {presentation.badge}
          </span>
          <ChevronDown size={13} aria-hidden="true" className={`text-[color:var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open ? (
        <section
          id={detailsId}
          aria-label="Share count used in valuation"
          className={`absolute right-0 top-full z-40 mt-2 max-h-[30rem] w-[min(27rem,calc(100vw-3rem))] overflow-auto rounded-xl border bg-[color:var(--surface-overlay)] p-4 shadow-2xl ${
            changed ? "border-[color:var(--warning-border)]" : "border-[color:var(--border-strong)]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-primary)]">
                Share count used in valuation
              </p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
                {presentation.summary}
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${
              changed
                ? "border-[color:var(--warning-border)] text-[color:var(--warning)]"
                : "border-[color:var(--border-subtle)] text-[color:var(--text-muted)]"
            }`}>
              {presentation.badge}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] p-3">
            <div className="min-w-0">
              <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Original Yahoo</dt>
              <dd className="mt-1 truncate text-xs font-semibold tabular-nums text-[color:var(--text-primary)]">{formatFullShares(originalShares)}</dd>
            </div>
            <ArrowRight size={14} aria-hidden="true" className="text-[color:var(--text-muted)]" />
            <div className="min-w-0 text-right">
              <dt className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Used in valuation</dt>
              <dd className="mt-1 truncate text-xs font-semibold tabular-nums text-[color:var(--text-primary)]">{formatFullShares(finalShares)}</dd>
            </div>
          </dl>
          <p className={`mt-2 text-right text-[11px] font-semibold tabular-nums ${changed ? "text-[color:var(--warning)]" : "text-[color:var(--text-muted)]"}`}>
            {difference}
          </p>

          {resolution ? (
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-[color:var(--text-muted)]">Verification</dt>
                <dd className="mt-0.5 font-medium text-[color:var(--text-primary)]">{presentation.verification}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--text-muted)]">Confidence</dt>
                <dd className="mt-0.5 font-medium text-[color:var(--text-primary)]">{resolution.confidence || "Not available"}</dd>
              </div>
              {resolution.as_of_date ? (
                <div className="sm:col-span-2">
                  <dt className="text-[color:var(--text-muted)]">Filing date</dt>
                  <dd className="mt-0.5 font-medium text-[color:var(--text-primary)]">{resolution.as_of_date}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {resolution?.evidence_excerpt ? (
            <blockquote className="mt-3 max-h-28 overflow-auto rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2 text-xs leading-5 text-[color:var(--text-secondary)]">
              <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Supporting filing text</span>
              {resolution.evidence_excerpt}
            </blockquote>
          ) : presentation.note ? (
            <p className="mt-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2 text-xs leading-5 text-[color:var(--text-secondary)]">
              {presentation.note}
            </p>
          ) : null}

          {providerCandidates.length > 1 ? (
            <div className="mt-3 border-t border-[color:var(--border-subtle)] pt-2">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">Yahoo cross-checks</p>
              <div className="mt-1 space-y-1 text-[11px] text-[color:var(--text-secondary)]">
                {providerCandidates.map(([key, value]) => (
                  <p key={key} className="flex justify-between gap-3">
                    <span>{providerCandidateLabel(key)}</span>
                    <strong className="shrink-0 font-semibold tabular-nums text-[color:var(--text-primary)]">{formatFullShares(value)}</strong>
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
