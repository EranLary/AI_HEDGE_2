"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import type { ReportListItem } from "@/lib/dashboard-types";
import { upsertActiveRun } from "@/lib/active-runs";
import { ThemeToggle } from "@/components/theme-toggle";
import { getProgressStep, getProgressStepNumber, RUN_PROGRESS_STEPS } from "@/lib/run-progress";

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

type RunStatusResponse = {
  job_id: string;
  ticker: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at?: string;
  llm_total_estimated?: number;
  llm_completed?: number;
  llm_progress_pct?: number;
  error?: string;
  progress?: string[];
  result?: {
    status?: string;
  };
};

export default function Home() {
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobTicker, setJobTicker] = useState("");
  const [status, setStatus] = useState<RunStatusResponse["status"] | "idle">("idle");
  const [progress, setProgress] = useState<string[]>([]);
  const [llmPct, setLlmPct] = useState(0);
  const [error, setError] = useState("");
  const [pollMisses, setPollMisses] = useState(0);
  const [reports, setReports] = useState<ReportListItem[]>([]);

  const normalizedTicker = useMemo(() => ticker.trim().toUpperCase(), [ticker]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!TICKER_RE.test(normalizedTicker)) {
      setError("Enter a valid ticker (letters/numbers, up to 10 chars).");
      return;
    }

    setError("");
    setStatus("queued");
    setProgress([]);
    setLlmPct(0);
    setJobTicker(normalizedTicker);

    try {
      const res = await fetch("/api/run-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: normalizedTicker }),
      });
      const json = (await res.json()) as { job_id?: string; error?: string; status?: string };
      if (!res.ok || !json.job_id) {
        throw new Error(json.error || "Failed to start analysis.");
      }
      setJobId(json.job_id);
      setStatus((json.status as RunStatusResponse["status"]) || "queued");
      setPollMisses(0);
      upsertActiveRun({
        job_id: json.job_id,
        ticker: normalizedTicker,
        status: ((json.status as RunStatusResponse["status"]) || "queued"),
        llm_progress_pct: 0,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      setStatus("failed");
      setError(String(err));
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadReports() {
      try {
        const res = await fetch("/api/reports", { cache: "no-store" });
        const json = (await res.json()) as { reports?: ReportListItem[] };
        if (!cancelled) {
          setReports(Array.isArray(json?.reports) ? json.reports : []);
        }
      } catch {
        if (!cancelled) {
          setReports([]);
        }
      }
    }
    loadReports();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/run-analysis/${jobId}`, { cache: "no-store" });
        const json = (await res.json()) as RunStatusResponse;
        if (!res.ok) {
          if (res.status === 404 && pollMisses < 8) {
            setPollMisses((v) => v + 1);
            return;
          }
          throw new Error(json.error || "Failed polling run status.");
        }
        if (cancelled) return;

        setPollMisses(0);
        setStatus(json.status);
        setProgress(Array.isArray(json.progress) ? json.progress : []);
        setLlmPct(Number(json.llm_progress_pct || 0));
        upsertActiveRun({
          job_id: json.job_id || jobId,
          ticker: String(json.ticker || jobTicker || "").toUpperCase(),
          status: json.status,
          llm_progress_pct: Number(json.llm_progress_pct || 0),
          created_at: String(json.created_at || new Date().toISOString()),
        });

        if (json.status === "completed") {
          setLlmPct(100);
          setTimeout(() => {
            router.push(`/dashboard?ticker=${json.ticker || jobTicker}`);
          }, 500);
        } else if (json.status === "failed") {
          setError(json.error || "Run failed.");
          setJobId("");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("failed");
          setError(String(err));
          setJobId("");
        }
      }
    };

    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, router, jobTicker, pollMisses]);

  const isRunning = status === "queued" || status === "running";
  const showProgress = isRunning || status === "completed" || status === "failed";
  const progressPct = Math.max(0, Math.min(100, llmPct));
  const progressStep = getProgressStep(progressPct);
  const progressStepNo = getProgressStepNumber(progressPct);

  return (
    <div className="hib-shell min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto flex min-h-[80vh] w-full max-w-4xl flex-col items-center justify-center">
        <div className="mb-6 flex w-full items-center justify-end gap-3">
          <Link href="/dashboard" className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.16em]">
            DASHBOARDS
          </Link>
          <Link href="/discovery" className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.16em]">
            MARKET DISCOVERY
          </Link>
          <ThemeToggle />
        </div>

        <div className="mb-8 text-center">
          <h1 className="font-display text-5xl tracking-tight text-zinc-100 sm:text-6xl">
            Hedge in a box
          </h1>
          <p className="mt-3 text-base text-zinc-200 sm:text-lg">A hedge fund in a box. Powered by AI. Ready in 30 minutes.</p>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-500">From raw data to investment-grade insight.</p>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-500">Run Full Valuation + Build Dashboards</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 p-4 shadow-2xl shadow-black/30 sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="Type ticker (e.g., NVDA)"
              className="flex-1 rounded-xl border border-white/15 bg-black/35 px-4 py-3 text-lg uppercase tracking-[0.08em] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-emerald-400/60"
              maxLength={10}
              disabled={isRunning}
            />
            <button
              type="submit"
              disabled={isRunning}
              className="hib-run-btn inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/60 bg-emerald-500/20 px-5 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {isRunning ? "Running..." : "Run Analysis"}
            </button>
          </div>
        </form>

        {error ? (
          <div className="mt-4 w-full rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</div>
        ) : null}

        {showProgress ? (
          <section className="mt-5 w-full rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <p className="uppercase tracking-[0.14em] text-zinc-400">Status: {status}</p>
              <p className="text-zinc-300">Step {progressStepNo}/{RUN_PROGRESS_STEPS.length}</p>
            </div>
            <div className="mb-2 flex items-end justify-between">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">{progressStep}</p>
              <p className="text-2xl font-semibold text-emerald-300">{progressPct.toFixed(1)}%</p>
            </div>
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-black/40">
              <div className="absolute inset-y-0 left-0 w-full animate-pulse bg-gradient-to-r from-emerald-500/5 via-transparent to-emerald-500/5" />
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-300 to-emerald-400 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-zinc-400">Progress updates adapt automatically every 10%.</p>

            <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-300">
              {(progress.length ? progress : ["Preparing run..."]).map((line, idx) => (
                <p key={`${idx}-${line.slice(0, 18)}`} className="mb-1 last:mb-0">
                  {line}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-6 flex items-center gap-4 text-xs uppercase tracking-[0.12em] text-zinc-500">
          <Link href="/dashboard" className="hover:text-zinc-300">
            Open Dashboards
          </Link>
          <Link href="/discovery" className="hover:text-zinc-300">
            Market Discovery
          </Link>
        </div>

        <section className="mt-8 w-full rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">All Generated Reports</p>
            <p className="text-xs text-zinc-500">{reports.length} total</p>
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border border-white/10 bg-black/25 p-2">
            {reports.length ? (
              reports.map((report) => (
                <Link
                  key={report.report_id}
                  href={`/dashboard?ticker=${report.ticker}&report=${encodeURIComponent(report.report_id)}`}
                  className="mb-1 block rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm transition hover:border-emerald-400/50 hover:bg-emerald-500/10 last:mb-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-100">{report.ticker}</span>
                    <span className="text-xs text-zinc-400">{new Date(report.generated_at).toLocaleString()}</span>
                  </div>
                </Link>
              ))
            ) : (
              <p className="px-2 py-3 text-sm text-zinc-500">No reports yet. Run your first analysis above.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
