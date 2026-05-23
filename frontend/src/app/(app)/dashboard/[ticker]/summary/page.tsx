"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type SummaryWindow = "all" | "1y" | "3m" | "1m" | "1w";

type MeanRow = {
  key: string;
  label: string;
  mean_target_price: number | null;
  mean_allocation_pct: number | null;
  target_samples: number;
  allocation_samples: number;
};

type AssumptionRow = {
  key: string;
  label: string;
  mean_value: number | null;
  samples: number;
};

type SummaryPayload = {
  generated_at: string;
  ticker: string;
  window: SummaryWindow;
  coverage: {
    reports_total: number;
    reports_in_window: number;
    window: SummaryWindow;
  };
  overview: {
    live_current_price: number | null;
    mean_target_price: number | null;
    mean_allocation_pct: number | null;
    mean_disagreement_score: number | null;
    target_samples: number;
    allocation_samples: number;
    disagreement_samples: number;
  };
  by_model: MeanRow[];
  by_valuator: MeanRow[];
  assumptions: AssumptionRow[];
};

type ReturnsMap = {
  "1D"?: number | null;
  "1W"?: number | null;
  "1M"?: number | null;
  "3M"?: number | null;
  "6M"?: number | null;
  "1Y"?: number | null;
  "3Y"?: number | null;
  "5Y"?: number | null;
};

type FilingStatusSnippet = {
  available: boolean;
  source: string;
  form_type: string;
  date: string;
  source_url: string;
};

type FilingsStatusPayload = {
  ok?: boolean;
  ticker?: string;
  filings?: {
    annual?: FilingStatusSnippet;
    quarterly?: FilingStatusSnippet;
  };
  context_error?: string;
  error?: string;
};

const RETURN_COLUMNS = ["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;

const WINDOW_OPTIONS: Array<{ key: SummaryWindow; label: string }> = [
  { key: "all", label: "All" },
  { key: "1y", label: "Last Year" },
  { key: "3m", label: "Last 3 Months" },
  { key: "1m", label: "Last Month" },
  { key: "1w", label: "Last Week" },
];

function fmtDateTimeNoSeconds(value: string): string {
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "N/A";
  return dt.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function escapeRegExp(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fmtFilingDateOnly(value: string): string {
  const txt = String(value || "").trim();
  if (!txt) return "";
  const prefix = txt.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(prefix)) return prefix;
  const dt = new Date(txt);
  if (!Number.isFinite(dt.getTime())) return txt;
  return dt.toISOString().slice(0, 10);
}

function cleanFilingFormLabel(source: string, formType: string): string {
  let label = String(formType || "").trim().replace(/\s+/g, " ");
  const sourceLabel = String(source || "").trim();
  if (!label) return "";
  if (sourceLabel) {
    const sourcePrefix = new RegExp(`^${escapeRegExp(sourceLabel)}\\s+`, "i");
    label = label.replace(sourcePrefix, "").trim();
  }
  return label;
}

function fmtMoney(value: number | null | undefined, ticker: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  const isIsraeliTicker = String(ticker || "").toUpperCase().endsWith(".TA");
  const currency = isIsraeliTicker ? "ILS" : "USD";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtNum(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toFixed(3);
}

function toneClassFromSign(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-zinc-100";
  if (Math.abs(value) <= 1e-9) return "text-zinc-200";
  return value > 0 ? "hib-target-up" : "hib-target-down";
}

function toneClassFromTarget(target: number | null | undefined, liveCurrent: number | null | undefined): string {
  if (typeof target !== "number" || !Number.isFinite(target)) return "text-zinc-100";
  if (typeof liveCurrent !== "number" || !Number.isFinite(liveCurrent)) return "text-zinc-100";
  if (Math.abs(target - liveCurrent) <= 1e-9) return "text-zinc-200";
  return target > liveCurrent ? "hib-target-up" : "hib-target-down";
}

function targetChangePct(target: number | null | undefined, liveCurrent: number | null | undefined): number | null {
  if (typeof target !== "number" || !Number.isFinite(target)) return null;
  if (typeof liveCurrent !== "number" || !Number.isFinite(liveCurrent) || Math.abs(liveCurrent) <= 1e-9) return null;
  return ((target - liveCurrent) / liveCurrent) * 100.0;
}

function compareRowsByMeanTargetDesc(a: MeanRow, b: MeanRow): number {
  const av = typeof a.mean_target_price === "number" && Number.isFinite(a.mean_target_price) ? a.mean_target_price : Number.NEGATIVE_INFINITY;
  const bv = typeof b.mean_target_price === "number" && Number.isFinite(b.mean_target_price) ? b.mean_target_price : Number.NEGATIVE_INFINITY;
  if (bv !== av) return bv - av;
  return a.label.localeCompare(b.label);
}

function combinedDecisionScore(investmentPct?: number | null, targetReturnPct?: number | null): number | null {
  const hasInvestment = typeof investmentPct === "number" && Number.isFinite(investmentPct);
  const hasTarget = typeof targetReturnPct === "number" && Number.isFinite(targetReturnPct);
  if (!hasInvestment && !hasTarget) return null;
  if (hasInvestment && hasTarget) return (0.5 * Number(investmentPct)) + (0.5 * Number(targetReturnPct));
  return hasInvestment ? Number(investmentPct) : Number(targetReturnPct);
}

function confidenceAdjustedScore(baseScore?: number | null, overallCv?: number | null): number | null {
  if (typeof baseScore !== "number" || !Number.isFinite(baseScore)) return null;
  const cv = typeof overallCv === "number" && Number.isFinite(overallCv) ? Math.max(0, overallCv) : 0;
  const confidenceFactor = 1 / (1 + Math.pow(cv, 1.3));
  return baseScore * confidenceFactor;
}

function decisionFromAdjustedScore(adjustedScore: number): {
  label: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
  tone: "buy" | "sell" | "hold";
} {
  if (adjustedScore >= 20) return { label: "Strong Buy", tone: "buy" };
  if (adjustedScore >= 5) return { label: "Buy", tone: "buy" };
  if (adjustedScore > -5) return { label: "Hold", tone: "hold" };
  if (adjustedScore > -20) return { label: "Sell", tone: "sell" };
  return { label: "Strong Sell", tone: "sell" };
}

function decisionClass(tone: "buy" | "sell" | "hold"): string {
  if (tone === "buy") return "hib-signal-buy";
  if (tone === "sell") return "hib-signal-sell";
  return "hib-signal-hold";
}

function ReturnsGrid({
  rows,
  loading,
}: {
  rows: ReturnsMap | null;
  loading: boolean;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.16em] text-zinc-300">Price Performance</h2>
      <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4 xl:grid-cols-8">
        {RETURN_COLUMNS.map((key) => {
          const value = rows?.[key];
          return (
            <div key={key} className="hib-perf-cell rounded-md bg-black/30 px-2 py-1.5">
              <span className="block text-[10px] uppercase tracking-[0.12em] text-zinc-500">{key}</span>
              {loading ? (
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-400">
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
                  Loading
                </span>
              ) : (
                <span
                  className={`mt-1 block text-sm font-semibold ${
                    typeof value === "number" && Number.isFinite(value) && Math.abs(value) > 1e-9
                      ? value > 0
                        ? "hib-target-up"
                        : "hib-target-down"
                      : "text-zinc-200"
                  }`}
                >
                  {typeof value === "number" && Number.isFinite(value) ? fmtPct(value) : "N/A"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MeanTable({
  title,
  rows,
  liveCurrentPrice,
  ticker,
}: {
  title: string;
  rows: MeanRow[];
  liveCurrentPrice: number | null;
  ticker: string;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.16em] text-zinc-300">{title}</h2>
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => {
          const changePct = targetChangePct(row.mean_target_price, liveCurrentPrice);
          return (
            <article key={`${row.key}-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{row.label}</p>
              <p className={`mt-1 text-xl font-bold ${toneClassFromTarget(row.mean_target_price, liveCurrentPrice)}`}>
                {fmtMoney(row.mean_target_price, ticker)}
              </p>
              <p className={`mt-1 text-xs font-semibold ${toneClassFromSign(changePct)}`}>
                Change vs Live: ({fmtPct(changePct)})
              </p>
              <p className="mt-2 text-[11px] text-zinc-400">Target N {row.target_samples}</p>
              <p className={`mt-2 text-sm font-semibold ${toneClassFromSign(row.mean_allocation_pct)}`}>
                {fmtPct(row.mean_allocation_pct)}
              </p>
              <p className="mt-1 text-[11px] text-zinc-400">Allocation N {row.allocation_samples}</p>
            </article>
          );
        })}
        {!rows.length ? <p className="text-sm text-zinc-500">No rows available.</p> : null}
      </div>
      <div className="overflow-auto rounded-xl border border-white/10 bg-black/25">
        <table className="hidden w-full min-w-[760px] text-sm sm:table">
          <thead className="border-b border-white/10 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Mean Target</th>
              <th className="px-3 py-2 text-right font-medium">Change vs Live</th>
              <th className="px-3 py-2 text-right font-medium">Target N</th>
              <th className="px-3 py-2 text-right font-medium">Mean Allocation</th>
              <th className="px-3 py-2 text-right font-medium">Allocation N</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const changePct = targetChangePct(row.mean_target_price, liveCurrentPrice);
              return (
              <tr key={row.key} className="border-b border-white/5 last:border-b-0">
                <td className="px-3 py-2 font-medium text-zinc-200">{row.label}</td>
                <td className={`px-3 py-2 text-right ${toneClassFromTarget(row.mean_target_price, liveCurrentPrice)}`}>
                  {fmtMoney(row.mean_target_price, ticker)}
                </td>
                <td className={`px-3 py-2 text-right ${toneClassFromSign(changePct)}`}>
                  ({fmtPct(changePct)})
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">{row.target_samples}</td>
                <td className={`px-3 py-2 text-right ${toneClassFromSign(row.mean_allocation_pct)}`}>
                  {fmtPct(row.mean_allocation_pct)}
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">{row.allocation_samples}</td>
              </tr>
            )})}
            {!rows.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-zinc-500">
                  No rows available.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssumptionsTable({ rows }: { rows: AssumptionRow[] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
      <h2 className="mb-3 text-sm uppercase tracking-[0.16em] text-zinc-300">Assumptions Mean Values</h2>
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <article key={`${row.key}-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{row.label}</p>
            <p className="mt-1 text-lg font-bold text-zinc-100">{fmtNum(row.mean_value)}</p>
            <p className="mt-1 text-xs text-zinc-400">N {row.samples}</p>
          </article>
        ))}
        {!rows.length ? <p className="text-sm text-zinc-500">No assumptions available.</p> : null}
      </div>
      <div className="overflow-auto rounded-xl border border-white/10 bg-black/25">
        <table className="hidden w-full min-w-[560px] text-sm sm:table">
          <thead className="border-b border-white/10 text-zinc-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Assumption</th>
              <th className="px-3 py-2 text-right font-medium">Mean</th>
              <th className="px-3 py-2 text-right font-medium">N</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-white/5 last:border-b-0">
                <td className="px-3 py-2 font-medium text-zinc-200">{row.label}</td>
                <td className="px-3 py-2 text-right text-zinc-100">{fmtNum(row.mean_value)}</td>
                <td className="px-3 py-2 text-right text-zinc-400">{row.samples}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-zinc-500">
                  No assumptions available.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DashboardSummaryPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = use(params);
  const search = useSearchParams();
  const upper = decodeURIComponent(String(ticker || "")).toUpperCase();
  const [windowKey, setWindowKey] = useState<SummaryWindow>("all");
  const [loading, setLoading] = useState(true);
  const [performanceLoading, setPerformanceLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [data, setData] = useState<SummaryPayload | null>(null);
  const [returnsMap, setReturnsMap] = useState<ReturnsMap | null>(null);
  const [filingsLoading, setFilingsLoading] = useState(true);
  const [filingsError, setFilingsError] = useState("");
  const [filings, setFilings] = useState<{
    annual: FilingStatusSnippet;
    quarterly: FilingStatusSnippet;
  } | null>(null);

  const reportId = search?.get("report") || "";

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/dashboard/${encodeURIComponent(upper)}/summary?window=${encodeURIComponent(windowKey)}&refresh=${Date.now()}-${refreshToken}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as SummaryPayload;
        if (!cancelled) {
          setData(json);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [upper, windowKey, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setPerformanceLoading(true);
      try {
        const res = await fetch(
          `/api/performance/${encodeURIComponent(upper)}?refresh=${Date.now()}-${refreshToken}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { returns_pct?: ReturnsMap };
        if (!cancelled) {
          setReturnsMap(json?.returns_pct || null);
        }
      } catch {
        if (!cancelled) {
          setReturnsMap(null);
        }
      } finally {
        if (!cancelled) {
          setPerformanceLoading(false);
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [upper, refreshToken]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setFilingsLoading(true);
      setFilingsError("");
      try {
        const refreshQuery =
          refreshToken > 0 ? `?refresh=${encodeURIComponent(`${Date.now()}-${refreshToken}`)}` : "";
        const res = await fetch(
          `/api/dashboard/${encodeURIComponent(upper)}/filings/status${refreshQuery}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as FilingsStatusPayload;
        if (!cancelled) {
          if (!res.ok || !json?.ok || !json?.filings) {
            setFilings(null);
            setFilingsError(String(json?.error || "Failed to load filing availability."));
          } else {
            setFilings({
              annual: {
                available: Boolean(json.filings.annual?.available),
                source: String(json.filings.annual?.source || ""),
                form_type: String(json.filings.annual?.form_type || ""),
                date: String(json.filings.annual?.date || ""),
                source_url: String(json.filings.annual?.source_url || ""),
              },
              quarterly: {
                available: Boolean(json.filings.quarterly?.available),
                source: String(json.filings.quarterly?.source || ""),
                form_type: String(json.filings.quarterly?.form_type || ""),
                date: String(json.filings.quarterly?.date || ""),
                source_url: String(json.filings.quarterly?.source_url || ""),
              },
            });
          }
        }
      } catch {
        if (!cancelled) {
          setFilings(null);
          setFilingsError("Failed to load filing availability.");
        }
      } finally {
        if (!cancelled) {
          setFilingsLoading(false);
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [upper, refreshToken]);

  const coverageText = useMemo(() => {
    if (!data) return "";
    return `Using ${data.coverage.reports_in_window} reports (out of ${data.coverage.reports_total}) for ${upper}.`;
  }, [data, upper]);

  const meanTargetChangePct =
    typeof data?.overview?.mean_target_price === "number" &&
    Number.isFinite(data.overview.mean_target_price) &&
    typeof data?.overview?.live_current_price === "number" &&
    Number.isFinite(data.overview.live_current_price) &&
    Math.abs(data.overview.live_current_price) > 1e-9
      ? ((data.overview.mean_target_price - data.overview.live_current_price) / data.overview.live_current_price) * 100
      : null;
  const modelRowsSorted = useMemo(
    () => (data?.by_model || []).slice().sort(compareRowsByMeanTargetDesc),
    [data?.by_model],
  );
  const valuatorRowsSorted = useMemo(
    () => (data?.by_valuator || []).slice().sort(compareRowsByMeanTargetDesc),
    [data?.by_valuator],
  );
  const overviewCombinedScore = combinedDecisionScore(data?.overview.mean_allocation_pct, meanTargetChangePct);
  const overviewAdjustedScore = confidenceAdjustedScore(overviewCombinedScore, data?.overview.mean_disagreement_score);
  const overviewDecision =
    typeof overviewAdjustedScore === "number" && Number.isFinite(overviewAdjustedScore)
      ? decisionFromAdjustedScore(overviewAdjustedScore)
      : null;

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-zinc-100">Overall Summary</h1>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              {upper} · Aggregated across report history
            </p>
            {reportId ? (
              <p className="mt-1 text-xs text-zinc-500">Current report selection is ignored here; this view always uses history.</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-white/15 bg-white/5 p-1">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setWindowKey(opt.key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                    windowKey === opt.key
                      ? "bg-emerald-500/20 text-emerald-100"
                      : "text-zinc-300 hover:text-zinc-100"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRefreshToken((v) => v + 1)}
              disabled={loading || filingsLoading}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-200 transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading || filingsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-start gap-3">
          {(["annual", "quarterly"] as const).map((kind) => {
            const row = filings?.[kind];
            const sourceHref = `/api/dashboard/${encodeURIComponent(upper)}/filings/${kind}/source`;
            const hasSource = Boolean(row?.available && String(row?.source_url || "").trim());
            const sourceLabel = String(row?.source || "").trim();
            const formLabel = cleanFilingFormLabel(sourceLabel, String(row?.form_type || ""));
            const dateLabel = fmtFilingDateOnly(String(row?.date || ""));
            const meta = filingsLoading && !row
              ? "Checking..."
              : row?.available
                ? [sourceLabel || "N/A", formLabel, dateLabel].filter(Boolean).join(" ").trim()
                : "Not available";
            return (
              <div key={kind} className="min-w-[210px] rounded-lg border border-white/10 bg-black/25 p-2">
                <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                  {kind === "annual" ? "Annual" : "Quarterly"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {hasSource ? (
                    <a
                      className="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-200 transition hover:border-white/35 hover:bg-white/10"
                      href={sourceHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source Filing
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-500 disabled:cursor-not-allowed"
                    >
                      Source Filing
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">{meta}</p>
              </div>
            );
          })}
          {filingsError ? (
            <p className="self-center text-xs text-amber-300">{filingsError}</p>
          ) : null}
        </div>
      </header>

      {loading || !data ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-28 animate-pulse rounded-xl border border-white/10 bg-white/5" />
          ))}
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-400">
            {coverageText} Generated at {fmtDateTimeNoSeconds(data.generated_at)}.
          </p>
          <ReturnsGrid rows={returnsMap} loading={performanceLoading} />

          <section className="grid gap-4 md:grid-cols-5">
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Current Live Price</p>
              <p className="hib-summary-metric-value mt-2 font-bold text-zinc-100">
                {fmtMoney(data.overview.live_current_price, upper)}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mean Target</p>
              <p
                className={`hib-summary-metric-value mt-2 font-bold ${toneClassFromTarget(
                  data.overview.mean_target_price,
                  data.overview.live_current_price,
                )}`}
              >
                {fmtMoney(data.overview.mean_target_price, upper)}
              </p>
              <p className={`mt-1 text-sm font-semibold ${toneClassFromSign(meanTargetChangePct)}`}>
                ({fmtPct(meanTargetChangePct)})
              </p>
              <p className="mt-2 text-xs text-zinc-400">N {data.overview.target_samples}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mean Allocation</p>
              <p className={`mt-2 text-3xl font-bold ${toneClassFromSign(data.overview.mean_allocation_pct)}`}>
                {fmtPct(data.overview.mean_allocation_pct)}
              </p>
              <p className="mt-2 text-xs text-zinc-400">N {data.overview.allocation_samples}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mean Disagreement Score</p>
              <p className="mt-2 text-3xl font-bold text-zinc-100">{fmtNum(data.overview.mean_disagreement_score)}</p>
              <p className="mt-2 text-xs text-zinc-400">N {data.overview.disagreement_samples}</p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mean Decision</p>
              <p className={`mt-2 text-2xl font-bold ${overviewDecision ? decisionClass(overviewDecision.tone) : "text-zinc-100"}`}>
                {overviewDecision
                  ? `${overviewDecision.label} (${typeof overviewAdjustedScore === "number" ? overviewAdjustedScore.toFixed(2) : "N/A"})`
                  : "N/A"}
              </p>
              <p className="mt-2 text-xs text-zinc-400">Confidence-adjusted point score</p>
            </article>
          </section>

          <MeanTable
            title="By Model Mean Target + Mean Allocation"
            rows={modelRowsSorted}
            liveCurrentPrice={data.overview.live_current_price}
            ticker={upper}
          />
          <MeanTable
            title="By Valuator Mean Target + Mean Allocation"
            rows={valuatorRowsSorted}
            liveCurrentPrice={data.overview.live_current_price}
            ticker={upper}
          />
          <AssumptionsTable rows={data.assumptions} />
        </>
      )}
    </div>
  );
}
