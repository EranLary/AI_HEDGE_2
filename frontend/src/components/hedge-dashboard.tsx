"use client";

import Link from "next/link";
import { Fragment, ReactNode, useEffect, useMemo, useState } from "react";
import { Download, Gauge } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DashboardMethodTab, DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { ThemeToggle } from "@/components/theme-toggle";

type MainTab = "valuation" | "executive" | "bull" | "bear" | "values";

const METHOD_METRIC_LABELS: Record<string, string> = {
  fcf_next_year: "FCF (Next Year)",
  growth_rate: "Growth Rate",
  wacc: "WACC",
  terminal_growth: "Terminal Value Growth",
  net_income_3y: "Net Income (3Y)",
  pe_multiple: "P/E Multiple",
  revenue_3y: "Revenue (3Y)",
  ev_sales_multiple: "EV/Sales Multiple",
  target_market_cap: "Target Market Cap",
  bull_target_market_cap: "Bull Target Market Cap",
  base_target_market_cap: "Base Target Market Cap",
  bear_target_market_cap: "Bear Target Market Cap",
  bull_net_income: "Bull Net Income",
  base_net_income: "Base Net Income",
  bear_net_income: "Bear Net Income",
  revenue_growth_3y_avg: "Revenue Growth (3Y Avg)",
  operating_margin: "Operating Profitability Margin",
  net_financing_result: "Net Financing Result",
};

const fmtMoney = (v?: number | null) =>
  typeof v === "number" && Number.isFinite(v)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v)
    : "N/A";
const fmtMoneyCompact = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${v < 0 ? "-" : ""}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${v < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
};
const fmtMarketCap = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
};
const fmtNum = (v?: number | null) =>
  typeof v === "number" && Number.isFinite(v) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(v) : "N/A";
const fmtPct = (v?: number | null) => (typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A");
const fmtLargeAware = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  return fmtNum(v);
};
const fmtAssumptionValue = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  return fmtNum(v);
};
const fmtDecisionPctOnly = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  if (Math.abs(v) < 1e-9) return "0.00%";
  return `${v > 0 ? "+" : "-"}${Math.abs(v).toFixed(2)}%`;
};
const NOTIONAL_BASE_USD = 100_000;
const toneClassFromSign = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "text-zinc-400";
  if (Math.abs(v) < 1e-9) return "text-zinc-200";
  return v > 0 ? "hib-target-up" : "hib-target-down";
};
const toneClassFromTarget = (target?: number | null, current?: number | null) => {
  if (typeof target !== "number" || !Number.isFinite(target)) return "text-zinc-400";
  if (typeof current !== "number" || !Number.isFinite(current) || Math.abs(target - current) < 1e-9) return "text-zinc-200";
  return target > current ? "hib-target-up" : "hib-target-down";
};
const fmtNotionalPct = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const pct = (v / NOTIONAL_BASE_USD) * 100;
  if (Math.abs(pct) < 1e-9) return "0.00%";
  return `${pct.toFixed(2)}%`;
};
const fmtTargetOrFloor = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "<0";
  return fmtMoneyCompact(v);
};

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

function BulletList({ items, tone = "bull" }: { items: string[]; tone?: "bull" | "bear" }) {
  if (!items.length) return <p className="text-sm text-zinc-500">No items yet.</p>;
  const dotClass = tone === "bear" ? "bg-red-400" : "bg-emerald-400";
  return (
    <ul className="space-y-2 text-sm text-zinc-200">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 12)}`} className="flex gap-2">
          <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
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
      className={`hib-tab rounded-lg border px-3 py-2 text-xs uppercase tracking-[0.14em] transition ${
        active ? "hib-tab-active border-emerald-400/60 bg-emerald-500/20 text-emerald-100" : "hib-tab-inactive border-white/15 bg-white/5 text-zinc-300"
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
  const leaf = raw.split(".").pop() || raw;
  const cleaned = leaf
    .replace(/\[\d+\]/g, " ")
    .replace(/[./_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const normalized = cleaned
    .replace(/\bratinale\b/g, "rationale")
    .replace(/\brationale\b/g, "rationale")
    .replace(/\bstep by step and rationale full text\b/g, "step by step analysis")
    .replace(/\bstep by step\b/g, "step by step analysis")
    .replace(/\bev\s+sales\b/g, "ev sales")
    .replace(/\bp\/e\b/g, "pe");

  const exactLabels: Record<string, string> = {
    "step by step analysis": "Step-by-Step Analysis",
    "fcf rationale": "FCF Rationale",
    "g rationale": "Growth Rate (G) Rationale",
    "growth rate rationale": "Growth Rate (G) Rationale",
    "wacc rationale": "WACC Rationale",
    "terminal rationale": "Terminal Value Rationale",
    "terminal value rationale": "Terminal Value Rationale",
    "ev sales rationale": "EV/Sales Rationale",
    "pe rationale": "P/E Rationale",
    "net income rationale": "Net Income Rationale",
    "revenue rationale": "Revenue Rationale",
    "target market cap rationale": "Target Market Cap Rationale",
    "investment rationale": "Investment Rationale",
    "bull rationale": "Bull Case Rationale",
    "base rationale": "Base Case Rationale",
    "bear rationale": "Bear Case Rationale",
    "revenue growth rationale": "Revenue Growth Rationale",
    "margin rationale": "Margin Rationale",
    "financing rationale": "Financing Rationale",
  };
  if (exactLabels[normalized]) return exactLabels[normalized];

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      if (token === "ev") return "EV";
      if (token === "pe") return "P/E";
      if (token === "fcf") return "FCF";
      if (token === "wacc") return "WACC";
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
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

function normalizeMetricLabel(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/[_/]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function prettyMetricName(raw: string): string {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return "Value";
  if (METHOD_METRIC_LABELS[key]) return METHOD_METRIC_LABELS[key];

  const tokenMap: Record<string, string> = {
    fcf: "FCF",
    wacc: "WACC",
    ev: "EV",
    pe: "P/E",
    ni: "NI",
    tv: "TV",
    y: "Y",
    avg: "Avg",
  };
  return key
    .split("_")
    .map((token) => {
      if (tokenMap[token]) return tokenMap[token];
      if (/^\d+y$/i.test(token)) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

function getDecisionSignal(pct?: number | null): { label: string; tone: "hold" | "underperform" | "sell" | "buy" | "strong" } {
  const v = typeof pct === "number" && Number.isFinite(pct) ? pct : 0;
  if (v <= -10) return { label: "Sell", tone: "sell" };
  if (v < -5) return { label: "Underperform", tone: "underperform" };
  if (v <= 5) return { label: "Hold", tone: "hold" };
  if (v <= 10) return { label: "Buy", tone: "buy" };
  return { label: "Strong Buy", tone: "strong" };
}

function ChartHoverTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { name?: string; target?: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row || !row.name) return null;
  return (
    <div className="hib-chart-tooltip rounded-lg border border-white/15 bg-zinc-950/95 px-3 py-2 shadow-xl">
      <p className="text-xs font-semibold tracking-[0.08em] text-zinc-100">{row.name}</p>
      <p className="text-sm font-medium text-zinc-200">{fmtMoney(row.target)}</p>
    </div>
  );
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
  const [showAssumptionsRangeMobile, setShowAssumptionsRangeMobile] = useState(false);

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
  const methodTabs = useMemo(
    () => data?.valuation_hub?.method_tabs || [],
    [data?.valuation_hub?.method_tabs],
  );
  const methodPerformerByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const tab of methodTabs) {
      const performers = Array.from(
        new Set(
          (tab.outputs || [])
            .map((o) => String(o.persona || "").trim())
            .filter(Boolean),
        ),
      );
      map.set(tab.name, performers.length ? performers.join(", ") : "Model Aggregate");
    }
    return map;
  }, [methodTabs]);
  const chartData = useMemo(() => {
    const blocks = data?.valuation_hub?.method_blocks || [];
    const currentPrice =
      typeof consensus?.current_price === "number" && Number.isFinite(consensus.current_price)
        ? Number(consensus.current_price)
        : null;
    const rows = blocks
      .filter((b) => typeof b.target_price === "number" && Number.isFinite(Number(b.target_price)))
      .map((b) => ({
        name: b.name,
        target: Number(b.target_price),
        aboveCurrent: typeof currentPrice === "number" ? Number(b.target_price) >= currentPrice : true,
        performer: methodPerformerByName.get(b.name) || "Model Aggregate",
        investment: b.investment_amount,
      }));
    if (rows.length) return rows;
    return [
      {
        name: "Mean",
        target: Number(consensus?.mean_target_price || 0),
        aboveCurrent: true,
        performer: "Consensus",
        investment: null,
      },
      {
        name: "Current",
        target: Number(consensus?.current_price || 0),
        aboveCurrent: true,
        performer: "Market",
        investment: null,
      },
    ];
  }, [consensus, data?.valuation_hub?.method_blocks, methodPerformerByName]);
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
  const activeMethodTargetClass = toneClassFromTarget(activeMethod?.target_price, consensusCurrent);
  const activeMethodInvestmentClass = toneClassFromSign(activeMethod?.investment_amount);
  const selectedOutputTargetClass = toneClassFromTarget(selectedOutput?.target_price, consensusCurrent);
  const selectedOutputInvestmentClass = toneClassFromSign(selectedOutput?.investment_amount);
  const chartScale = useMemo(() => {
    const values = chartData
      .map((x) => Number(x.target))
      .filter((x) => Number.isFinite(x));
    if (typeof consensusCurrent === "number") {
      values.push(consensusCurrent);
    }
    if (!values.length) {
      return {
        min: 0,
        max: 1,
        ticks: [0, 0.25, 0.5, 0.75, 1],
        currentEpsilon: 0.001,
      };
    }
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (Math.abs(max - min) < 1e-9) {
      const pad = Math.max(Math.abs(max) * 0.1, 1);
      min -= pad;
      max += pad;
    }
    const span = max - min;
    const margin = Math.max(span * 0.08, Math.max(Math.abs(max), Math.abs(min), 1) * 0.03);
    min -= margin;
    max += margin;

    const ticks: number[] = [];
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      ticks.push(min + ((max - min) * i) / steps);
    }
    if (typeof consensusCurrent === "number") {
      ticks.push(consensusCurrent);
    }
    const uniqueTicks = Array.from(
      new Set(
        ticks
          .map((t) => Number(t.toFixed(6)))
          .filter((t) => Number.isFinite(t)),
      ),
    ).sort((a, b) => a - b);

    return {
      min,
      max,
      ticks: uniqueTicks,
      currentEpsilon: Math.max((max - min) * 0.002, 1e-6),
    };
  }, [chartData, consensusCurrent]);

  const targetTableRows = useMemo(() => {
    const currentPrice =
      typeof consensus?.current_price === "number" && Number.isFinite(consensus.current_price)
        ? Number(consensus.current_price)
        : null;
    const rows = (data?.valuation_hub?.method_blocks || []).map((b) => {
      const target =
        typeof b.target_price === "number" && Number.isFinite(Number(b.target_price))
          ? Number(b.target_price)
          : null;
      const changePct =
        typeof currentPrice === "number" && Math.abs(currentPrice) > 1e-9 && typeof target === "number"
          ? ((target - currentPrice) / currentPrice) * 100
          : null;
      return {
        name: b.name,
        target,
        investment: b.investment_amount,
        changePct,
      };
    });
    return rows.sort((a, b) => {
      const at = typeof a.target === "number" ? a.target : Number.NEGATIVE_INFINITY;
      const bt = typeof b.target === "number" ? b.target : Number.NEGATIVE_INFINITY;
      if (bt !== at) return bt - at;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [consensus, data?.valuation_hub?.method_blocks]);
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

  const assumptionsModelRows = useMemo(() => {
    const sourceRows = data?.valuation_hub.all_values?.metric_means || [];
    const rows: typeof sourceRows = [];
    const mergeBuckets: Record<
      string,
      {
        label: string;
        metric_key: string;
        items: typeof sourceRows;
      }
    > = {
      predicted_ev_sales: {
        label: "Predicted EV/Sales",
        metric_key: "predicted_ev_sales",
        items: [],
      },
      predicted_fcf_next_year: {
        label: "Predicted FCF (Next Year)",
        metric_key: "predicted_fcf_next_year",
        items: [],
      },
      growth_rate_g: {
        label: "Growth Rate (G)",
        metric_key: "growth_rate_g",
        items: [],
      },
      terminal_value_growth: {
        label: "Terminal Value Growth",
        metric_key: "terminal_value_growth",
        items: [],
      },
      wacc: {
        label: "WACC",
        metric_key: "wacc",
        items: [],
      },
    };

    const removeExact = new Set([
      "investment amount",
      "net financing result",
      "net income 3y 0",
      "net income 3y 1",
      "revenue 3y 0",
      "revenue 3y 1",
      "operating profitability margin",
      "target market cap",
      "revenue growth 3y avg",
    ]);

    for (const row of sourceRows) {
      const baseLabel = String(row.label || row.metric_key || "").trim();
      if (!baseLabel) continue;
      const normalized = normalizeMetricLabel(baseLabel);

      if (normalized === "base 1" || normalized === "bear 1" || normalized === "bull 1") {
        continue;
      }

      if (
        removeExact.has(normalized) ||
        normalized === "p e multiple" ||
        normalized === "pe multiple" ||
        normalized === "pe multiple 0" ||
        normalized === "pe multiple 1"
      ) {
        continue;
      }

      if (normalized === "ev sales multiple 0" || normalized === "ev sales multiple 1") {
        mergeBuckets.predicted_ev_sales.items.push(row);
        continue;
      }
      if (normalized === "fcf next year 0" || normalized === "fcf next year 1") {
        mergeBuckets.predicted_fcf_next_year.items.push(row);
        continue;
      }
      if (normalized === "g 0" || normalized === "g 1") {
        mergeBuckets.growth_rate_g.items.push(row);
        continue;
      }
      if (normalized === "terminal 0" || normalized === "terminal 1") {
        mergeBuckets.terminal_value_growth.items.push(row);
        continue;
      }
      if (normalized === "wacc 0" || normalized === "wacc 1") {
        mergeBuckets.wacc.items.push(row);
        continue;
      }

      const renamedLabel =
        normalized === "base 0"
          ? "Base Probability"
          : normalized === "bear 0"
          ? "Bear Probability"
          : normalized === "bull 0"
          ? "Bull Probability"
          : baseLabel;

      rows.push({ ...row, label: renamedLabel });
    }

    for (const bucket of Object.values(mergeBuckets)) {
      if (!bucket.items.length) continue;
      const means = bucket.items.map((x) => Number(x.mean)).filter((x) => Number.isFinite(x));
      const mins = bucket.items.map((x) => Number(x.min)).filter((x) => Number.isFinite(x));
      const maxs = bucket.items.map((x) => Number(x.max)).filter((x) => Number.isFinite(x));
      const methods = Array.from(new Set(bucket.items.flatMap((x) => x.methods || [])));

      rows.push({
        metric_key: bucket.metric_key,
        label: bucket.label,
        mean: avg(means),
        min: avg(mins),
        max: avg(maxs),
        sample_count: bucket.items.reduce((s, x) => s + Number(x.sample_count || 0), 0),
        method_count: methods.length,
        methods,
        source_paths: [],
      });
    }
    return rows;
  }, [data?.valuation_hub.all_values?.metric_means]);

  const assumptionsByNorm = useMemo(() => {
    const m = new Map<string, (typeof assumptionsModelRows)[number]>();
    for (const row of assumptionsModelRows) {
      const key = normalizeMetricLabel(String(row.label || ""));
      if (!key || m.has(key)) continue;
      m.set(key, row);
    }
    return m;
  }, [assumptionsModelRows]);

  const assumptionsDisplayRows = useMemo(() => {
    const orderedLabels = [
      "Base Probability",
      "Bull Probability",
      "Bear Probability",
      "",
      "Growth Rate (G)",
      "Predicted FCF (Next Year)",
      "Terminal Value Growth",
      "WACC",
      "",
      "Predicted EV/Sales",
      "Predicted P/E",
      "Predicted Earnings",
      "Predicted Revenue",
    ];
    return orderedLabels.map((label, idx) => {
      if (!label) {
        return { type: "spacer" as const, key: `spacer-${idx}` };
      }
      const row = assumptionsByNorm.get(normalizeMetricLabel(label));
      return row ? { type: "metric" as const, key: `metric-${idx}`, row } : null;
    }).filter(Boolean);
  }, [assumptionsByNorm]);

  const fmtProbability = (v?: number | null) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
    const pct = Math.abs(v) <= 1 ? v * 100 : v;
    const clamped = Math.max(0, Math.min(100, pct));
    return `${clamped.toFixed(1)}%`;
  };

  const bullProbability = assumptionsByNorm.get(normalizeMetricLabel("Bull Probability"))?.mean ?? null;
  const bearProbability = assumptionsByNorm.get(normalizeMetricLabel("Bear Probability"))?.mean ?? null;
  const decisionSignal = getDecisionSignal(data?.decision_card?.position_size_pct_of_notional);
  const decisionToneClass = `hib-signal-${decisionSignal.tone}`;

  return (
    <div className="hib-shell min-h-screen">
      <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-6 sm:px-8">
        <header className="mb-6 grid gap-3 rounded-2xl border border-white/10 bg-black/35 p-4 sm:grid-cols-[1fr_auto_auto]">
          <div>
            <h1 className="font-display text-2xl text-zinc-100">DASHBOARDS</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Institutional Dashboards</p>
          </div>
          <label htmlFor="dashboard-ticker-select" className="rounded-lg border border-white/15 bg-zinc-950/80 px-3 py-2">
            <span className="mr-2 text-xs uppercase tracking-[0.16em] text-zinc-400">Ticker</span>
            <select
              id="dashboard-ticker-select"
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
          </label>
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.16em]">
              New Run
            </Link>
            <Link href="/discovery" className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.16em]">
              Market Discovery
            </Link>
            <ThemeToggle />
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
                        ? "hib-tab-active border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                        : "hib-tab-inactive border-white/15 bg-white/5 text-zinc-300"
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
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-white/10 bg-black/35 p-2"><p className="text-zinc-500">Price</p><p>{fmtMoney(data.header.current_price)}</p></div>
                  <div className="rounded-lg border border-white/10 bg-black/35 p-2"><p className="text-zinc-500">Market Cap</p><p>{fmtMarketCap(data.header.market_cap)}</p></div>
                </div>
              </article>
            </section>

            <section className="mb-4 flex flex-wrap gap-2">
              <Tab active={mainTab === "valuation"} onClick={() => setMainTab("valuation")} label="Valuation Engine" />
              <Tab active={mainTab === "executive"} onClick={() => setMainTab("executive")} label="Executive Summary" />
              <Tab active={mainTab === "bull"} onClick={() => setMainTab("bull")} label="Bull Case" />
              <Tab active={mainTab === "bear"} onClick={() => setMainTab("bear")} label="Bear Case" />
              <Tab active={mainTab === "values"} onClick={() => setMainTab("values")} label="Assumptions" />
            </section>

            {mainTab === "valuation" ? (
              <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <div className="mb-3 inline-flex items-center gap-2 text-zinc-300"><Gauge size={14} /> Consensus + Models</div>
                <div className="hib-chart h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#29303a" />
                      <XAxis dataKey="name" tick={false} axisLine={false} tickLine={false} />
                      <YAxis
                        width={140}
                        domain={[chartScale.min, chartScale.max]}
                        ticks={chartScale.ticks}
                        tickFormatter={(v) => {
                          const value = Number(v);
                          const label = fmtMoney(value);
                          if (
                            typeof consensusCurrent === "number" &&
                            Math.abs(value - consensusCurrent) <= chartScale.currentEpsilon
                          ) {
                            return `${label} Current`;
                          }
                          return label;
                        }}
                      />
                      {Number(consensus?.current_price || 0) > 0 ? (
                        <ReferenceLine
                          y={Number(consensus?.current_price || 0)}
                          stroke="#f59e0b"
                          strokeWidth={2.5}
                          strokeDasharray="6 4"
                        />
                      ) : null}
                      <Bar
                        dataKey="target"
                        radius={[6, 6, 0, 0]}
                        isAnimationActive
                        activeBar={false}
                      >
                        {chartData.map((entry) => (
                          <Cell
                            key={`target-${entry.name}`}
                            fill={entry.aboveCurrent ? "#22c55e" : "#f87171"}
                            style={{ cursor: "pointer" }}
                          />
                        ))}
                      </Bar>
                      <Tooltip
                        cursor={false}
                        content={<ChartHoverTooltip />}
                        wrapperStyle={{ outline: "none" }}
                      />
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
                  <div className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black/30">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="border-b border-white/10 text-zinc-400">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Model Name</th>
                          <th className="px-3 py-2 text-right font-medium">Target Price</th>
                          <th className="px-3 py-2 text-right font-medium">Change vs Current</th>
                          <th className="px-3 py-2 text-right font-medium">Investment %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {targetTableRows.map((row) => (
                          <tr key={row.name} className="border-b border-white/5 text-xs sm:text-sm">
                            <td className="px-3 py-2 font-medium text-zinc-200">{row.name}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${toneClassFromTarget(row.target, consensusCurrent)}`}>
                              {fmtTargetOrFloor(row.target)}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold ${toneClassFromSign(row.changePct)}`}>
                              {typeof row.changePct === "number" ? fmtPct(row.changePct) : "-"}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold ${toneClassFromSign(row.investment)}`}>{fmtNotionalPct(row.investment)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : activeMethod ? (
                  <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.2fr]">
                    <article className="rounded-xl border border-white/10 bg-black/35 p-3">
                      <p className="font-semibold">{activeMethod.name}</p>
                      <p className="text-sm text-zinc-400">
                        Mean Target: <span className={`font-semibold ${activeMethodTargetClass}`}>{fmtTargetOrFloor(activeMethod.target_price)}</span>
                      </p>
                      <p className="text-sm text-zinc-400">
                        Mean Investment: <span className={`font-semibold ${activeMethodInvestmentClass}`}>{fmtNotionalPct(activeMethod.investment_amount)}</span>
                      </p>
                      {Object.entries(activeMethod.key_metric_means || {}).map(([k, v]) => (
                        <p key={k} className="text-xs text-zinc-500">
                          {prettyMetricName(k)}: {fmtLargeAware(v)}
                        </p>
                      ))}
                    </article>
                    <article className="rounded-xl border border-white/10 bg-black/35 p-3">
                      {activeMethod.outputs.length ? (
                        <>
                          <div className="mb-2 flex flex-wrap gap-2">{activeMethod.outputs.map((o) => { const key = o.persona || `Output ${o.output_id}`; return <Tab key={key} active={(outputTab[activeMethod.name] || (activeMethod.outputs[0].persona || `Output ${activeMethod.outputs[0].output_id}`)) === key} onClick={() => setOutputTab((p) => ({ ...p, [activeMethod.name]: key }))} label={key} />; })}</div>
                          {selectedOutput ? (
                            <>
                              <p className="text-sm text-zinc-400">
                                Target: <span className={`font-semibold ${selectedOutputTargetClass}`}>{fmtTargetOrFloor(selectedOutput.target_price)}</span>{" "}
                                | Investment: <span className={`font-semibold ${selectedOutputInvestmentClass}`}>{fmtNotionalPct(selectedOutput.investment_amount)}</span>
                              </p>
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
                            </>
                          ) : (
                            <p className="text-sm text-zinc-500">No output details were found for this method in this report.</p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-zinc-500">No output details were found for this method in this report.</p>
                      )}
                    </article>
                  </div>
                ) : null}
              </section>
            ) : null}

            {mainTab === "executive" ? <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4"><MarkdownBlock text={data.analysis_matrix.executive_summary_markdown || ""} /></section> : null}
            {mainTab === "bull" ? (
              <section className="mb-6 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4">
                <div className="mb-4 rounded-xl border border-emerald-400/35 bg-emerald-400/10 p-3">
                  <p className="hib-bull-prob-label text-xs uppercase tracking-[0.14em]">Bull Probability</p>
                  <p className="hib-bull-prob-value text-2xl font-semibold">{fmtProbability(bullProbability)}</p>
                </div>
                <BulletList items={bullReasons} tone="bull" />
              </section>
            ) : null}
            {mainTab === "bear" ? (
              <section className="mb-6 rounded-2xl border border-red-500/35 bg-red-500/10 p-4">
                <div className="mb-4 rounded-xl border border-red-400/35 bg-red-400/10 p-3">
                  <p className="hib-bear-prob-label text-xs uppercase tracking-[0.14em]">Bear Probability</p>
                  <p className="hib-bear-prob-value text-2xl font-semibold">{fmtProbability(bearProbability)}</p>
                </div>
                <BulletList items={bearReasons} tone="bear" />
              </section>
            ) : null}
            {mainTab === "values" ? (
              <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <div className="mb-3 sm:hidden">
                  <button
                    type="button"
                    onClick={() => setShowAssumptionsRangeMobile((v) => !v)}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-300"
                  >
                    {showAssumptionsRangeMobile ? "Hide Min/Max" : "Show Min/Max"}
                  </button>
                </div>
                <div className="overflow-auto">
                  <table className="hib-values-table w-full text-sm sm:min-w-[620px]">
                    <thead className="border-b border-white/10 text-zinc-500">
                      <tr>
                        <th className="py-1 text-left font-normal">Metric</th>
                        <th className="py-1 text-right font-normal">Mean</th>
                        <th className={`py-1 text-right font-normal sm:table-cell ${showAssumptionsRangeMobile ? "table-cell" : "hidden"}`}>Min</th>
                        <th className={`py-1 text-right font-normal sm:table-cell ${showAssumptionsRangeMobile ? "table-cell" : "hidden"}`}>Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assumptionsDisplayRows.map((entry) =>
                        entry?.type === "spacer" ? (
                          <tr key={entry.key}>
                            <td colSpan={4} className="h-3" />
                          </tr>
                        ) : entry?.type === "metric" ? (
                          <tr key={entry.key} className="border-b border-white/5">
                            <td className="py-1 pr-2">{entry.row.label}</td>
                            <td className="py-1 text-right font-mono">{fmtAssumptionValue(entry.row.mean)}</td>
                            <td className={`py-1 text-right font-mono sm:table-cell ${showAssumptionsRangeMobile ? "table-cell" : "hidden"}`}>{fmtAssumptionValue(entry.row.min)}</td>
                            <td className={`py-1 text-right font-mono sm:table-cell ${showAssumptionsRangeMobile ? "table-cell" : "hidden"}`}>{fmtAssumptionValue(entry.row.max)}</td>
                          </tr>
                        ) : null,
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <section className="grid gap-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4 lg:grid-cols-[1fr_auto]">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Decision</p>
                <p className={`text-3xl font-semibold ${decisionToneClass}`}>{decisionSignal.label}</p>
                <p className={`text-lg font-semibold ${decisionToneClass}`}>
                  Mean Investment Decision: {fmtDecisionPctOnly(data.decision_card.position_size_pct_of_notional)}
                </p>
                <p className="text-sm text-zinc-400">CV: {typeof lmilCvRaw === "number" ? fmtNum(lmilCvRaw) : "N/A"}</p>
              </div>
              <div className="grid gap-2">
                <a className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm" href={data.downloads?.analysis_pdf}><Download size={14} />Analysis PDF</a>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

