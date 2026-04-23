"use client";

import Link from "next/link";
import { Fragment, ReactNode, useEffect, useMemo, useState } from "react";
import { Download, Gauge, Sun } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DashboardMethodTab, DashboardPayload, ReportListItem } from "@/lib/dashboard-types";

type MainTab = "valuation" | "executive" | "bull" | "bear" | "values";

const fmtMoney = (v?: number | null) =>
  typeof v === "number" && Number.isFinite(v)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v)
    : "N/A";
const fmtNum = (v?: number | null) =>
  typeof v === "number" && Number.isFinite(v) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(v) : "N/A";
const fmtPct = (v?: number | null) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A");

function renderInlineMarkdown(text: string): ReactNode {
  return String(text || "")
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, i) => {
      const bold = part.match(/^\*\*([^*]+)\*\*$/);
      return bold ? (
        <strong key={i} className="font-semibold text-zinc-100">
          {bold[1]}
        </strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      );
    });
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-sm text-zinc-500">No items yet.</p>;
  return (
    <ul className="space-y-2 text-sm text-zinc-200">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 12)}`} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
          <span>{renderInlineMarkdown(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-xs uppercase tracking-[0.14em] transition ${
        active ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100" : "border-white/15 bg-white/5 text-zinc-300"
      }`}
    >
      {label}
    </button>
  );
}

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="hib-markdown text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function prettyReasonLabel(label: string): string {
  const raw = String(label || "").trim();
  if (!raw) return "Rationale";
  const clean = raw
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (clean === "step by step analysis" || clean === "step by step") return "Step-by-Step Analysis";
  return clean.replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeReasonText(text: string): string {
  const src = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!src) return "";
  const mergedLines = src.replace(/([^\n])\n(?!\n)/g, "$1 ");
  return mergedLines.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function reportTimestamp(report: ReportListItem): number {
  const raw = String(report.generated_at || report.updated_at || "");
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export function HedgeDashboard() {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [tickers, setTickers] = useState<string[]>([]);
  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mainTab, setMainTab] = useState<MainTab>("valuation");
  const [valuationTab, setValuationTab] = useState("overview");
  const [outputTab, setOutputTab] = useState<Record<string, string>>({});

  const toggleTheme = () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("hib-theme", next);
  };

  useEffect(() => {
    const tickerFromUrl =
      typeof window !== "undefined"
        ? String(new URLSearchParams(window.location.search).get("ticker") || "")
            .trim()
            .toUpperCase()
        : "";
    const reportFromUrl =
      typeof window !== "undefined"
        ? String(new URLSearchParams(window.location.search).get("report") || "").trim()
        : "";
    const saved = localStorage.getItem("hib-theme");
    document.documentElement.setAttribute("data-theme", saved === "light" ? "light" : "dark");

    Promise.all([
      fetch("/api/reports", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ reports: [] })),
      fetch("/api/tickers", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ tickers: [] })),
    ])
      .then(([reportsJson, tickersJson]) => {
        const reportRows = Array.isArray(reportsJson?.reports) ? (reportsJson.reports as ReportListItem[]) : [];
        reportRows.sort((a, b) => reportTimestamp(b) - reportTimestamp(a));
        setReports(reportRows);
        const tickerRows = Array.isArray(tickersJson?.tickers) ? tickersJson.tickers : [];
        const reportTickers = reportRows.map((r) => String(r.ticker || "").toUpperCase()).filter(Boolean);
        const mergedTickers = Array.from(new Set([...reportTickers, ...tickerRows.map((x: string) => String(x || "").toUpperCase())]));
        const finalList = mergedTickers.length ? mergedTickers : ["AAPL"];

        if (tickerFromUrl && !finalList.includes(tickerFromUrl)) {
          finalList.unshift(tickerFromUrl);
        }
        setTickers(finalList);

        const reportFromQuery = reportFromUrl
          ? reportRows.find((r) => String(r.report_id || "") === reportFromUrl)
          : null;
        const initialTicker =
          String(reportFromQuery?.ticker || "").toUpperCase() ||
          tickerFromUrl ||
          finalList[0] ||
          "AAPL";
        setSelectedTicker((prev) => prev || initialTicker);

        if (reportFromQuery && String(reportFromQuery.ticker || "").toUpperCase() === initialTicker) {
          setSelectedReportId((prev) => prev || reportFromQuery.report_id || "");
          return;
        }

        const newestForTicker = reportRows.find((r) => String(r.ticker || "").toUpperCase() === initialTicker);
        setSelectedReportId((prev) => prev || newestForTicker?.report_id || "");
      })
      .catch(() => {
        const fallback = tickerFromUrl || "AAPL";
        setTickers([fallback]);
        setSelectedTicker((prev) => prev || fallback);
        setError("Ticker/report list failed to load. Using fallback.");
      });
  }, []);

  const reportsForSelectedTicker = useMemo(
    () =>
      reports
        .filter((r) => String(r.ticker || "").toUpperCase() === String(selectedTicker || "").toUpperCase())
        .sort((a, b) => reportTimestamp(b) - reportTimestamp(a)),
    [reports, selectedTicker],
  );
  const currentReportId =
    selectedTicker && reportsForSelectedTicker.length
      ? reportsForSelectedTicker.some((r) => r.report_id === selectedReportId)
        ? selectedReportId
        : reportsForSelectedTicker[0].report_id
      : "";

  useEffect(() => {
    if (!selectedTicker) return;
    const url = currentReportId
      ? `/api/dashboard/${selectedTicker}?report=${encodeURIComponent(currentReportId)}`
      : `/api/dashboard/${selectedTicker}`;
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: DashboardPayload) => {
        setData(j);
        setMainTab("valuation");
        setValuationTab("overview");
        setOutputTab({});
        setError("");
      })
      .catch(() => setError(`Failed to load dashboard for ${selectedTicker}.`))
      .finally(() => setLoading(false));
  }, [selectedTicker, currentReportId]);

  const consensus = data?.valuation_hub?.consensus;
  const chartData = useMemo(() => {
    const blocks = data?.valuation_hub?.method_blocks || [];
    const rows = blocks
      .filter((b) => typeof b.target_price === "number" && Number.isFinite(Number(b.target_price)))
      .map((b) => ({
        name: b.name,
        target: Number(b.target_price),
      }));
    if (rows.length) return rows;
    return [
      { name: "Mean", target: Number(consensus?.mean_target_price || 0) },
      { name: "Current", target: Number(consensus?.current_price || 0) },
    ];
  }, [consensus, data?.valuation_hub?.method_blocks]);
  const methodTabs = data?.valuation_hub?.method_tabs || [];
  const activeMethod: DashboardMethodTab | null = methodTabs.find((m) => m.name === valuationTab) || null;
  const selectedOutput = activeMethod
    ? activeMethod.outputs.find((o) => (o.persona || `Output ${o.output_id}`) === outputTab[activeMethod.name]) || activeMethod.outputs[0]
    : null;
  const consensusCurrent =
    typeof consensus?.current_price === "number" && Number.isFinite(consensus.current_price)
      ? Number(consensus.current_price)
      : null;
  const consensusMean =
    typeof consensus?.mean_target_price === "number" && Number.isFinite(consensus.mean_target_price)
      ? Number(consensus.mean_target_price)
      : null;
  const consensusChangeAbs =
    typeof consensusCurrent === "number" && typeof consensusMean === "number"
      ? consensusMean - consensusCurrent
      : null;
  const consensusChangePct =
    typeof consensusCurrent === "number" && typeof consensusMean === "number" && Math.abs(consensusCurrent) > 1e-9
      ? ((consensusMean - consensusCurrent) / consensusCurrent) * 100
      : null;
  const consensusCvRaw =
    typeof consensus?.cv === "number" && Number.isFinite(consensus.cv) ? Math.abs(Number(consensus.cv)) : null;
  const lmilCvRaw =
    Array.isArray(consensus?.lmil) && typeof consensus?.lmil?.[1] === "number"
      ? Math.abs(Number(consensus.lmil[1]))
      : null;
  const bullReasons =
    data?.analysis_matrix?.bull_case_reasons ||
    data?.analysis_matrix?.documents?.bull_case?.reasons ||
    [];
  const bearReasons =
    data?.analysis_matrix?.bear_case_reasons ||
    data?.analysis_matrix?.documents?.bear_case?.reasons ||
    [];
  const reportDateText =
    data?.generated_at || data?.report_mtime
      ? new Date(String(data?.generated_at || data?.report_mtime)).toLocaleString()
      : "N/A";

  return (
    <div className="hib-shell min-h-screen">
      <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-6 sm:px-8">
        <header className="mb-6 grid gap-3 rounded-2xl border border-white/10 bg-black/35 p-4 sm:grid-cols-[1fr_auto_auto]">
          <div>
            <h1 className="font-display text-2xl text-zinc-100">Hedge in a Box</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Institutional Dashboard</p>
          </div>
          <div className="rounded-lg border border-white/15 bg-zinc-950/80 px-3 py-2">
            <label className="mr-2 text-xs uppercase tracking-[0.16em] text-zinc-400">Ticker</label>
            <select
              value={selectedTicker}
              onChange={(e) => {
                setLoading(true);
                setSelectedTicker(String(e.target.value || "").toUpperCase());
                setSelectedReportId("");
              }}
              className="hib-select bg-transparent outline-none"
            >
              {(tickers.length ? tickers : [selectedTicker || "AAPL"]).map((tk) => (
                <option key={tk} value={tk} className="hib-select-option">
                  {tk}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.16em]">
              New Run
            </Link>
            <button type="button" onClick={toggleTheme} className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.16em]">
              <span className="inline-flex items-center gap-1">
                <Sun size={12} /> Theme
              </span>
            </button>
            <Link href="/discovery" className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.16em]">
              Market Discovery
            </Link>
          </div>
        </header>

        {reportsForSelectedTicker.length > 1 ? (
          <section className="mb-4 rounded-xl border border-white/10 bg-zinc-950/70 p-3">
            <p className="mb-2 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Report Versions ({selectedTicker}) - Newest to Oldest
            </p>
            <div className="flex flex-wrap gap-2">
              {reportsForSelectedTicker.map((report) => {
                const active = report.report_id === currentReportId;
                return (
                  <button
                    key={report.report_id}
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      setSelectedReportId(report.report_id);
                    }}
                    className={`rounded-lg border px-3 py-2 text-xs transition ${
                      active
                        ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                        : "border-white/15 bg-white/5 text-zinc-300"
                    }`}
                  >
                    {new Date(report.generated_at || report.updated_at).toLocaleString()}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {error ? <div className="mb-4 rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-100">{error}</div> : null}
        {loading || !data ? (
          <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/5" />)}</div>
        ) : (
          <>
            <section className="mb-6">
              <article className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">{data.ticker}</p>
                <h2 className="text-2xl font-semibold">{data.header.company_name || data.ticker}</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Report Date: {reportDateText}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-lg border border-white/10 bg-black/35 p-2"><p className="text-zinc-500">Price</p><p>{fmtMoney(data.header.current_price)}</p></div>
                  <div className="rounded-lg border border-white/10 bg-black/35 p-2"><p className="text-zinc-500">Market Cap</p><p>{fmtNum(data.header.market_cap)}</p></div>
                  <div className="rounded-lg border border-white/10 bg-black/35 p-2"><p className="text-zinc-500">Shares</p><p>{fmtNum(data.header.shares_outstanding)}</p></div>
                </div>
              </article>
            </section>

            <section className="mb-4 flex flex-wrap gap-2">
              <Tab active={mainTab === "valuation"} onClick={() => setMainTab("valuation")} label="Valuation Engine" />
              <Tab active={mainTab === "executive"} onClick={() => setMainTab("executive")} label="Executive Summary" />
              <Tab active={mainTab === "bull"} onClick={() => setMainTab("bull")} label="Bull Case" />
              <Tab active={mainTab === "bear"} onClick={() => setMainTab("bear")} label="Bear Case" />
              <Tab active={mainTab === "values"} onClick={() => setMainTab("values")} label="All Values" />
            </section>

            {mainTab === "valuation" ? (
              <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <div className="mb-3 inline-flex items-center gap-2 text-zinc-300"><Gauge size={14} /> Consensus + Models</div>
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#29303a" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={(v) => fmtMoney(Number(v))} />
                      <Tooltip formatter={(value) => fmtMoney(Number(value))} />
                      {Number(consensus?.current_price || 0) > 0 ? (
                        <ReferenceLine
                          y={Number(consensus?.current_price || 0)}
                          stroke="#60a5fa"
                          strokeDasharray="4 4"
                          label={{ value: `Current ${fmtMoney(consensus?.current_price)}`, fill: "#93c5fd", fontSize: 11 }}
                        />
                      ) : null}
                      <Bar dataKey="target" fill="#10b981" radius={[6, 6, 0, 0]}>
                        <LabelList
                          dataKey="target"
                          position="top"
                          formatter={(v) => fmtMoney(typeof v === "number" ? v : Number(v))}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 grid gap-2 text-base font-medium text-zinc-300 sm:grid-cols-4">
                  <p>Current: {fmtMoney(consensus?.current_price)}</p>
                  <p>Mean: {fmtMoney(consensus?.mean_target_price)}</p>
                  <p>
                    Change:{" "}
                    {typeof consensusChangeAbs === "number" && typeof consensusChangePct === "number"
                      ? `${fmtMoney(consensusChangeAbs)} (${fmtPct(consensusChangePct)})`
                      : "N/A"}
                  </p>
                  <p>CV: {typeof consensusCvRaw === "number" ? fmtNum(consensusCvRaw) : "N/A"}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Tab active={valuationTab === "overview"} onClick={() => setValuationTab("overview")} label="Overview" />
                  {methodTabs.map((m) => <Tab key={m.name} active={valuationTab === m.name} onClick={() => setValuationTab(m.name)} label={m.name} />)}
                </div>
                {valuationTab === "overview" ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.valuation_hub.method_blocks.map((b) => <article key={b.name} className="rounded-xl border border-white/10 bg-black/35 p-3"><p className="font-semibold">{b.name}</p><p className="text-sm text-zinc-400">Target: {fmtMoney(b.target_price)}</p><p className="text-sm text-zinc-400">Investment: {fmtMoney(b.investment_amount)}</p><p className="text-xs text-zinc-500">{fmtPct(b.upside_pct)} vs current</p></article>)}</div>
                ) : activeMethod && selectedOutput ? (
                  <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.2fr]">
                    <article className="rounded-xl border border-white/10 bg-black/35 p-3"><p className="font-semibold">{activeMethod.name}</p><p className="text-sm text-zinc-400">Mean Target: {fmtMoney(activeMethod.target_price)}</p><p className="text-sm text-zinc-400">Mean Investment: {fmtMoney(activeMethod.investment_amount)}</p>{Object.entries(activeMethod.key_metric_means || {}).map(([k, v]) => <p key={k} className="text-xs text-zinc-500">{k}: {fmtNum(v)}</p>)}</article>
                    <article className="rounded-xl border border-white/10 bg-black/35 p-3">
                      <div className="mb-2 flex flex-wrap gap-2">{activeMethod.outputs.map((o) => { const key = o.persona || `Output ${o.output_id}`; return <Tab key={key} active={(outputTab[activeMethod.name] || (activeMethod.outputs[0].persona || `Output ${activeMethod.outputs[0].output_id}`)) === key} onClick={() => setOutputTab((p) => ({ ...p, [activeMethod.name]: key }))} label={key} />; })}</div>
                      <p className="text-sm text-zinc-400">Target: {fmtMoney(selectedOutput.target_price)} | Investment: {fmtMoney(selectedOutput.investment_amount)}</p>
                      <div className="mt-2 max-h-[28rem] overflow-auto text-sm text-zinc-200">
                        {selectedOutput.reason_sections.length ? (
                          selectedOutput.reason_sections.map((r) => (
                            <details key={r.path} className="mb-2 rounded border border-white/10 bg-black/30 p-3" open>
                              <summary className="cursor-pointer font-medium">{prettyReasonLabel(r.label)}</summary>
                              <p className="mt-2 whitespace-pre-line leading-relaxed text-zinc-300">{normalizeReasonText(r.text)}</p>
                            </details>
                          ))
                        ) : (
                          <p className="text-sm text-zinc-500">No step-by-step rationale found for this output.</p>
                        )}
                      </div>
                    </article>
                  </div>
                ) : null}
              </section>
            ) : null}

            {mainTab === "executive" ? <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4"><MarkdownBlock text={data.analysis_matrix.executive_summary_markdown || ""} /></section> : null}
            {mainTab === "bull" ? (
              <section className="mb-6 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4">
                <BulletList items={bullReasons} />
              </section>
            ) : null}
            {mainTab === "bear" ? (
              <section className="mb-6 rounded-2xl border border-red-500/35 bg-red-500/10 p-4">
                <BulletList items={bearReasons} />
              </section>
            ) : null}
            {mainTab === "values" ? <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4"><div className="overflow-auto"><table className="w-full min-w-[780px] text-sm"><thead className="border-b border-white/10 text-zinc-500"><tr><th className="py-1 text-left font-normal">Metric</th><th className="py-1 text-right font-normal">Mean</th><th className="py-1 text-right font-normal">Min</th><th className="py-1 text-right font-normal">Max</th><th className="py-1 text-right font-normal">Samples</th><th className="py-1 text-left font-normal">Methods</th></tr></thead><tbody>{(data.valuation_hub.all_values?.metric_means || []).map((r) => <tr key={r.metric_key} className="border-b border-white/5"><td className="py-1 pr-2">{r.label}</td><td className="py-1 text-right font-mono">{fmtNum(r.mean)}</td><td className="py-1 text-right font-mono">{fmtNum(r.min)}</td><td className="py-1 text-right font-mono">{fmtNum(r.max)}</td><td className="py-1 text-right">{r.sample_count}</td><td className="py-1 text-xs text-zinc-400">{r.methods.join(", ")}</td></tr>)}</tbody></table></div></section> : null}

            <section className="grid gap-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4 lg:grid-cols-[1fr_auto]">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Decision</p>
                <p className="text-xl font-semibold">{data.decision_card.action} {fmtPct(data.decision_card.position_size_pct_of_notional)}</p>
                <p className="text-sm text-zinc-400">Mean Investment: {fmtMoney(data.decision_card.mean_investment_amount)}</p>
                <p className="text-sm text-zinc-400">CV: {typeof lmilCvRaw === "number" ? fmtNum(lmilCvRaw) : "N/A"}</p>
              </div>
              <div className="grid gap-2">
                <a className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm" href={data.downloads?.analysis_pdf}><Download size={14} />Analysis PDF</a>
                <a className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm" href={data.downloads?.prices_explain_txt}><Download size={14} />Prices Explain TXT</a>
                <a className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm" href={data.downloads?.dashboard_json}><Download size={14} />Dashboard JSON</a>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
