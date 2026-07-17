"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Download,
  Loader2,
  RefreshCw,
  ScanSearch,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { submitNewRun } from "@/lib/run-submission";
import { subscribeRunCompletion } from "@/components/shell/active-runs-store";

type ScreenerRow = {
  rank: number;
  ticker: string;
  query_ticker?: string;
  company_name: string;
  sector: string;
  industry: string;
  valuation_score?: number | null;
  quality_score?: number | null;
  overall_score?: number | null;
  score_confidence?: number | null;
  valuation_coverage?: number | null;
  quality_coverage?: number | null;
  current_price?: number | null;
  target_price?: number | null;
  target_samples?: number | null;
  target_change_pct?: number | null;
};

type ScreenerPayload = {
  status?: string;
  generated_at?: string;
  universe?: string;
  universe_label?: string;
  source?: string;
  source_url?: string;
  count?: number;
  missing_profiles?: number;
  missing_scores?: number;
  target_matches?: number;
  cache_hit?: boolean;
  rows?: ScreenerRow[];
  error?: string;
};

type SortKey =
  | "rank"
  | "ticker"
  | "company_name"
  | "current_price"
  | "target_price"
  | "target_change_pct"
  | "overall_score"
  | "valuation_score"
  | "quality_score"
  | "sector"
  | "industry";
type SortDirection = "asc" | "desc";

const SCREENERS = [
  { key: "sp500", label: "S&P 500", api: "/api/screeners/sp500" },
  { key: "nasdaq100", label: "NASDAQ 100", api: "/api/screeners/nasdaq100" },
  { key: "ta125", label: "TA-125", api: "/api/screeners/ta125" },
] as const;

type FilterOption = {
  value: string;
  label: string;
};

function fmtDate(value: string | undefined): string {
  if (!value) return "N/A";
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "N/A";
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtTime(value: string | undefined): string {
  if (!value) return "";
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function clean(value: string | undefined): string {
  return String(value || "").trim() || "Unknown";
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows: ScreenerRow[], filename: string) {
  const header = [
    "Rank",
    "Ticker",
    "Company",
    "Valuation Score",
    "Quality Score",
    "Overall Score",
    "Price",
    "Target",
    "Change %",
    "Sector",
    "Industry",
  ];
  const body = rows.map((row) => [
    row.rank,
    row.ticker,
    row.company_name,
    fmtScore(row.valuation_score),
    fmtScore(row.quality_score),
    fmtScore(row.overall_score),
    fmtNumber(row.current_price),
    fmtNumber(row.target_price),
    fmtPct(row.target_change_pct),
    clean(row.sector),
    clean(row.industry),
  ]);
  const csv = [header, ...body].map((line) => line.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sourceLabel(payload: ScreenerPayload | null): string {
  if (!payload?.source) return "Universe source";
  if (payload.source === "slickcharts") return "Slickcharts";
  if (payload.source === "slickcharts-seed") return "Slickcharts seed";
  if (payload.source === "tradingview") return "TradingView";
  if (payload.source === "tradingview-seed") return "TradingView seed";
  if (payload.source === "wikipedia-fallback") return "Fallback universe";
  return payload.source;
}

function fmtScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
}

function fmtNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value >= 100 ? value.toFixed(2) : value.toFixed(2);
}

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function numericScore(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scoreClass(value: number | null | undefined): string {
  const score = numericScore(value);
  if (score == null) return "text-[color:var(--text-muted)]";
  if (score >= 70) return "text-emerald-200";
  if (score >= 45) return "text-[color:var(--text-primary)]";
  return "text-[color:var(--danger)]";
}

function targetTone(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) < 1e-9) return "text-[color:var(--text-secondary)]";
  return value > 0 ? "hib-target-up" : "hib-target-down";
}

function sortValue(row: ScreenerRow, key: SortKey): string | number | null {
  if (key === "rank") return row.rank;
  if (key === "ticker") return row.ticker;
  if (key === "company_name") return row.company_name;
  if (key === "sector") return clean(row.sector);
  if (key === "industry") return clean(row.industry);
  if (key === "current_price") return numericScore(row.current_price);
  if (key === "target_price") return numericScore(row.target_price);
  if (key === "target_change_pct") return numericScore(row.target_change_pct);
  return numericScore(row[key]);
}

function analysisTicker(row: ScreenerRow): string {
  return String(row.query_ticker || row.ticker || "").trim().toUpperCase();
}

function SortHeader({
  id,
  label,
  sortKey,
  sortDirection,
  onSort,
  className = "",
}: {
  id: SortKey;
  label: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const activeSort = sortKey === id;
  const Icon = !activeSort ? ArrowUpDown : sortDirection === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`hib-market-table-head ${className}`}
      aria-sort={activeSort ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(id)}
        className="inline-flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)] transition hover:text-[color:var(--text-primary)]"
      >
        <span>{label}</span>
        <Icon size={13} className={activeSort ? "text-[color:var(--accent)]" : "text-[color:var(--text-muted)]"} />
      </button>
    </th>
  );
}

export default function ScreenersPage() {
  const [activeScreener, setActiveScreener] = useState<(typeof SCREENERS)[number]["key"]>("sp500");
  const [payload, setPayload] = useState<ScreenerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("All");
  const [industry, setIndustry] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("overall_score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [analysisRow, setAnalysisRow] = useState<ScreenerRow | null>(null);
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [runNotice, setRunNotice] = useState("");

  const active = SCREENERS.find((item) => item.key === activeScreener) || SCREENERS[0];

  async function fetchScreener(refresh = false): Promise<ScreenerPayload> {
    const params = refresh ? "?refresh=1" : "";
    const res = await fetch(`${active.api}${params}`, { cache: "no-store" });
    const json = (await res.json()) as ScreenerPayload;
    if (!res.ok || json.status !== "success") {
      throw new Error(json.error || `Screener failed (${res.status})`);
    }
    return json;
  }

  async function refreshData() {
    setRefreshing(true);
    setError("");
    try {
      setPayload(await fetchScreener(true));
    } catch (err) {
      setError((err as Error)?.message || "Screener data is unavailable.");
      setPayload(null);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const json = await fetchScreener(false);
        if (!cancelled) {
          setPayload(json);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error)?.message || "Screener data is unavailable.");
          setPayload(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScreener]);

  useEffect(() => {
    return subscribeRunCompletion((event) => {
      if (event.status !== "completed") return;
      setRunNotice(`${event.ticker} analysis completed. Refreshing screener targets...`);
      fetchScreener(false)
        .then((json) => {
          setPayload(json);
          setError("");
          setRunNotice(`${event.ticker} analysis completed. Screener targets refreshed.`);
        })
        .catch((err) => {
          setRunNotice((err as Error)?.message || "Analysis completed, but screener refresh failed.");
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => payload?.rows || [], [payload?.rows]);
  const sectors = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = clean(row.sector);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const options = Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => ({ value, label: `${value} (${count})` }));
    return [{ value: "All", label: `All sectors (${rows.length})` }, ...options];
  }, [rows]);
  const industries = useMemo<FilterOption[]>(() => {
    const pool = sector === "All" ? rows : rows.filter((row) => clean(row.sector) === sector);
    const counts = new Map<string, number>();
    for (const row of pool) {
      const key = clean(row.industry);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const options = Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => ({ value, label: `${value} (${count})` }));
    return [{ value: "All", label: `All industries (${pool.length})` }, ...options];
  }, [rows, sector]);
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const sectorMatch = sector === "All" || clean(row.sector) === sector;
      const industryMatch = industry === "All" || clean(row.industry) === industry;
      const queryMatch = !needle
        || row.ticker.toLowerCase().includes(needle)
        || row.company_name.toLowerCase().includes(needle)
        || clean(row.sector).toLowerCase().includes(needle)
        || clean(row.industry).toLowerCase().includes(needle);
      return sectorMatch && industryMatch && queryMatch;
    });
  }, [industry, query, rows, sector]);
  const sortedRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filteredRows].sort((left, right) => {
      const leftValue = sortValue(left, sortKey);
      const rightValue = sortValue(right, sortKey);
      const leftMissing = leftValue === null || leftValue === "";
      const rightMissing = rightValue === null || rightValue === "";
      if (leftMissing && rightMissing) return left.rank - right.rank;
      if (leftMissing) return 1;
      if (rightMissing) return -1;
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        const diff = leftValue - rightValue;
        return diff === 0 ? left.rank - right.rank : diff * direction;
      }
      const diff = String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: "base", numeric: true });
      return diff === 0 ? left.rank - right.rank : diff * direction;
    });
  }, [filteredRows, sortDirection, sortKey]);

  const sectorCount = sectors.length > 0 ? sectors.length - 1 : 0;
  const industryCount = useMemo(
    () => Array.from(new Set(rows.map((row) => clean(row.industry)))).filter((item) => item !== "Unknown").length,
    [rows],
  );
  const companyCount = payload?.count ?? rows.length;
  const scoredCount = rows.filter((row) => numericScore(row.overall_score) != null).length;
  const updatedDate = fmtDate(payload?.generated_at);
  const updatedTime = fmtTime(payload?.generated_at);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(["rank", "ticker", "company_name", "sector", "industry"].includes(key) ? "asc" : "desc");
  }

  async function startAnalysis(row: ScreenerRow) {
    setStartingAnalysis(true);
    setRunNotice("");
    try {
      const result = await submitNewRun(analysisTicker(row));
      setRunNotice(`Started ${result.ticker} analysis. Targets will update after the new report is saved.`);
      setAnalysisRow(null);
    } catch (err) {
      setRunNotice((err as Error)?.message || "Could not start analysis.");
    } finally {
      setStartingAnalysis(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-6 text-[color:var(--text-primary)] sm:px-8">
      <header className="overflow-hidden rounded-2xl border border-white/10 bg-black/35 p-5 backdrop-blur-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">
              <ScanSearch size={14} className="text-[color:var(--accent)]" />
              Screeners
            </div>
            <h1 className="font-display text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
              Market screeners
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[color:var(--text-secondary)]">
              {active.label} constituents with yahooquery price, sector, industry, valuation, quality, and platform target context.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SCREENERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setQuery("");
                  setSector("All");
                  setIndustry("All");
                  setLoading(true);
                  setError("");
                  setActiveScreener(item.key);
                }}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  activeScreener === item.key
                    ? "hib-tab-active border-emerald-400/60 bg-emerald-500/20"
                    : "hib-tab-inactive border-white/15 bg-white/5 hover:border-emerald-400/50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-white/10 bg-zinc-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Companies</p>
          <p className="mt-2 font-mono text-2xl font-semibold">{companyCount || "-"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Sectors</p>
          <p className="mt-2 font-mono text-2xl font-semibold">{sectorCount || "-"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Industries</p>
          <p className="mt-2 font-mono text-2xl font-semibold">{industryCount || "-"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Scored</p>
          <p className="mt-2 font-mono text-2xl font-semibold">{scoredCount || "-"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--text-muted)]">Updated</p>
          <p className="mt-2 flex flex-wrap items-baseline gap-2 font-mono">
            <span className="text-lg font-semibold">{updatedDate}</span>
            {updatedTime ? (
              <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--text-muted)]">
                {updatedTime}
              </span>
            ) : null}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-[minmax(16rem,1.2fr)_minmax(12rem,0.8fr)_minmax(12rem,0.8fr)]">
            <label className="relative block">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search company, ticker, sector..."
                className="w-full rounded-lg border border-white/15 bg-black/25 py-2.5 pl-10 pr-3 text-sm text-[color:var(--text-primary)] outline-none transition placeholder:text-[color:var(--text-muted)] focus:border-emerald-400/60"
              />
            </label>
            <label className="relative block">
              <Building2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
              <select
                value={sector}
                onChange={(event) => {
                  setSector(event.target.value);
                  setIndustry("All");
                }}
                className="hib-select w-full appearance-none rounded-lg border border-white/15 bg-black/25 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-emerald-400/60"
              >
                {sectors.map((item) => (
                  <option className="hib-select-option" key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="relative block">
              <SlidersHorizontal size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
              <select
                value={industry}
                onChange={(event) => setIndustry(event.target.value)}
                className="hib-select w-full appearance-none rounded-lg border border-white/15 bg-black/25 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-emerald-400/60"
              >
                {industries.map((item) => (
                  <option className="hib-select-option" key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={refreshData}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-[color:var(--text-secondary)] transition hover:border-emerald-400/50 hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
            >
              {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Refresh
            </button>
            <button
              type="button"
              onClick={() => downloadCsv(sortedRows, `${activeScreener}-screener.csv`)}
              disabled={!sortedRows.length}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
            >
              <Download size={15} />
              CSV
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--text-muted)]">
          <span>
            Showing <span className="font-mono text-[color:var(--text-secondary)]">{filteredRows.length}</span> of{" "}
            <span className="font-mono text-[color:var(--text-secondary)]">{rows.length}</span>
          </span>
          <span>
            {sourceLabel(payload)}
            {payload?.cache_hit ? " / cached" : ""}
            {payload?.missing_scores ? ` / ${payload.missing_scores} unscored` : ""}
            {payload?.target_matches ? ` / ${payload.target_matches} targets` : ""}
          </span>
        </div>
        {runNotice ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-[color:var(--text-secondary)]">
            {runNotice}
          </div>
        ) : null}
      </section>

      <section className="min-h-[34rem] rounded-2xl border border-white/10 bg-zinc-950/70 p-2 sm:p-3">
        {loading ? (
          <div className="flex min-h-[32rem] items-center justify-center">
            <div className="text-center">
              <Loader2 size={28} className="mx-auto mb-3 animate-spin text-[color:var(--accent)]" />
              <p className="text-sm font-semibold text-[color:var(--text-secondary)]">Loading {active.label}</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex min-h-[32rem] items-center justify-center px-4 text-center">
            <div>
              <p className="text-lg font-semibold text-[color:var(--danger)]">Screener unavailable</p>
              <p className="mt-2 max-w-xl text-sm text-[color:var(--text-secondary)]">{error}</p>
            </div>
          </div>
        ) : (
          <div className="hib-market-table-wrap m-0 max-h-[72vh]">
            <table className="hib-market-table min-w-[104rem] table-fixed">
              <thead>
                <tr>
                  <SortHeader id="rank" label="Rank" sortKey={sortKey} sortDirection={sortDirection} onSort={toggleSort} className="w-20" />
                  <SortHeader id="ticker" label="Ticker" sortKey={sortKey} sortDirection={sortDirection} onSort={toggleSort} className="w-28" />
                  <SortHeader
                    id="company_name"
                    label="Company"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    className="w-[24rem]"
                  />
                  <SortHeader
                    id="valuation_score"
                    label="Valuation Score"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    className="w-40"
                  />
                  <SortHeader
                    id="quality_score"
                    label="Quality Score"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    className="w-36"
                  />
                  <SortHeader
                    id="overall_score"
                    label="Overall Score"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    className="w-36"
                  />
                  <SortHeader
                    id="current_price"
                    label="Price"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    className="w-28"
                  />
                  <SortHeader
                    id="target_price"
                    label="Target"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    className="w-28"
                  />
                  <SortHeader
                    id="target_change_pct"
                    label="Change"
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    className="w-28"
                  />
                  <SortHeader id="sector" label="Sector" sortKey={sortKey} sortDirection={sortDirection} onSort={toggleSort} className="w-52" />
                  <SortHeader id="industry" label="Industry" sortKey={sortKey} sortDirection={sortDirection} onSort={toggleSort} className="w-72" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.length ? (
                  sortedRows.map((row) => (
                    <tr key={`${row.rank}-${row.ticker}`}>
                      <td className="hib-market-table-cell font-mono text-xs text-[color:var(--text-muted)]">#{row.rank}</td>
                      <td className="hib-market-table-cell">
                        <button
                          type="button"
                          onClick={() => {
                            setRunNotice("");
                            setAnalysisRow(row);
                          }}
                          className="inline-flex rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono text-xs font-semibold text-[color:var(--accent)] transition hover:border-emerald-400/60 hover:bg-emerald-500/10 hover:text-emerald-100"
                          title={`Start analysis for ${analysisTicker(row)}`}
                        >
                          {row.ticker}
                        </button>
                      </td>
                      <td className="hib-market-table-cell">
                        <p className="font-semibold text-[color:var(--text-primary)]">{row.company_name}</p>
                        {row.query_ticker && row.query_ticker !== row.ticker ? (
                          <p className="mt-1 font-mono text-[11px] text-[color:var(--text-muted)]">Yahoo: {row.query_ticker}</p>
                        ) : null}
                      </td>
                      <td className={`hib-market-table-cell font-mono text-sm font-semibold ${scoreClass(row.valuation_score)}`}>
                        {fmtScore(row.valuation_score)}
                      </td>
                      <td className={`hib-market-table-cell font-mono text-sm font-semibold ${scoreClass(row.quality_score)}`}>
                        {fmtScore(row.quality_score)}
                      </td>
                      <td className={`hib-market-table-cell font-mono text-sm font-semibold ${scoreClass(row.overall_score)}`}>
                        {fmtScore(row.overall_score)}
                      </td>
                      <td className="hib-market-table-cell font-mono text-sm text-[color:var(--text-primary)]">
                        {fmtNumber(row.current_price)}
                      </td>
                      <td className={`hib-market-table-cell font-mono text-sm font-semibold ${targetTone(row.target_change_pct)}`}>
                        {fmtNumber(row.target_price)}
                      </td>
                      <td className={`hib-market-table-cell font-mono text-sm font-semibold ${targetTone(row.target_change_pct)}`}>
                        {fmtPct(row.target_change_pct)}
                      </td>
                      <td className="hib-market-table-cell font-medium text-[color:var(--text-primary)]">{clean(row.sector)}</td>
                      <td className="hib-market-table-cell whitespace-normal font-medium leading-snug text-[color:var(--text-primary)]">
                        {clean(row.industry)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="hib-market-table-cell py-14 text-center text-[color:var(--text-muted)]">
                      No companies match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {analysisRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="hib-modal-surface w-full max-w-md rounded-2xl border border-white/15 bg-zinc-950 p-5 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)]">Start analysis</p>
            <h2 className="mt-2 text-xl font-semibold text-[color:var(--text-primary)]">{analysisTicker(analysisRow)}</h2>
            <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
              Start a new full analysis for {analysisRow.company_name}?
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setAnalysisRow(null)}
                disabled={startingAnalysis}
                className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-[color:var(--text-secondary)] transition hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => startAnalysis(analysisRow)}
                disabled={startingAnalysis}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/60 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)]"
              >
                {startingAnalysis ? <Loader2 size={15} className="animate-spin" /> : null}
                Yes, start
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
