"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DashboardMethodTab, DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { ThemeToggle } from "@/components/theme-toggle";
import { canonicalModelName } from "@/lib/method-display";

type MainTab = "valuation" | "executive" | "bull" | "bear" | "values";

export type HedgeDashboardProps = {
  tickerOverride?: string;
  reportIdOverride?: string;
  forceMainTab?: MainTab;
  hideNavHeader?: boolean;
  hideMainTabBar?: boolean;
  hideScoreFooter?: boolean;
  onReportChange?: (reportId: string) => void;
  postHeaderSlot?: ReactNode;
};

export type CurrencyContext = {
  code: string;
  symbol: string;
  financialCode: string;
  financialSymbol: string;
  isIsraeli: boolean;
  priceUsdToDisplay: number;
  financialUsdToDisplay: number;
};

const METHOD_METRIC_LABELS: Record<string, string> = {
  fcf_next_year: "FCF (Next Year)",
  growth_rate: "Growth Rate (G)",
  wacc: "WACC",
  terminal_growth: "Terminal Value Growth",
  net_income_3y: "Net Income (3Y)",
  pe_multiple: "P/E Multiple",
  revenue_3y: "Revenue (3Y)",
  ev_sales_multiple: "EV/Sales Multiple",
  representative_ev_current: "Representative EV",
  target_market_cap: "Target Market Cap",
  bull_probability: "Bull Probability",
  base_probability: "Base Probability",
  bear_probability: "Bear Probability",
  revenue_growth_3y_avg: "Revenue Growth (3Y Avg)",
  operating_margin: "EBIT Margin",
  net_financing_result: "Net Financing Result",
  tax_rate: "Tax Rate",
};

const MODEL_EXPLANATIONS: Record<string, string> = {
  "Scenario DCF": "Scenario DCF runs a full Bull/Base/Bear discounted-cash-flow map with explicit probabilities for each path. Instead of one fragile set of assumptions, it blends three coherent operating realities into one weighted intrinsic value.",
  "Dream Team": "Multiple investor personas analyze the same stock independently, each with a different style and risk appetite. Their outputs are aggregated so you can see a balanced, multi-angle view instead of relying on one voice.",
  "Target Scenario": "This framework forces a full scenario map: Bull, Base, and Bear cases with explicit probabilities. It helps separate upside story from downside risk and gives a weighted target grounded in all three paths.",
  "Earnings Scenario": "This is the scenario version of earnings-based valuation: each Bull/Base/Bear case gets its own net income and P/E assumptions. The final target reflects both business outcomes and changing market sentiment across scenarios.",
  "Revenue Scenario": "This scenario model underwrites Bull/Base/Bear revenue outcomes with explicit probabilities, then applies one shared long-term EV/S multiple to convert weighted operating reality into target price.",
  "Composite Scenario": "Composite Scenario is a full Bull/Base/Bear synthesis of growth, margin, financing, tax, and valuation multiple assumptions, producing a probability-weighted target that stress-tests execution and cycle risk.",
  "SOTP Scenario": "SOTP Scenario values each business segment separately in Bull/Base/Bear configurations, then combines scenario probabilities to produce a weighted equity value target.",
};

const MONEY_METRIC_KEYS = new Set([
  "target_market_cap",
  "bull_target_market_cap",
  "base_target_market_cap",
  "bear_target_market_cap",
  "bull_net_income",
  "base_net_income",
  "bear_net_income",
  "net_income_3y",
  "revenue_3y",
  "representative_ev_current",
  "fcf_next_year",
]);

const ASSUMPTION_MONEY_LABELS = new Set([
  "representative revenue",
  "representative earnings",
  "representative fcf",
]);
const PROBABILITY_METRIC_KEYS = new Set([
  "bull_probability",
  "base_probability",
  "bear_probability",
]);
const DECIMAL_PERCENT_METRIC_KEYS = new Set([
  "growth_rate",
  "terminal_growth",
  "wacc",
  "revenue_growth_3y_avg",
  "operating_margin",
  "tax_rate",
]);
const METHOD_METRIC_ORDER: Record<string, string[]> = {
  "Scenario DCF": [
    "bull_probability",
    "base_probability",
    "bear_probability",
    "representative_ev_current",
    "fcf_next_year",
    "growth_rate",
    "wacc",
    "terminal_growth",
  ],
  "Target Scenario": [
    "bull_probability",
    "base_probability",
    "bear_probability",
    "target_market_cap",
  ],
  "Earnings Scenario": [
    "bull_probability",
    "base_probability",
    "bear_probability",
    "pe_multiple",
    "net_income_3y",
  ],
  "Revenue Scenario": [
    "bull_probability",
    "base_probability",
    "bear_probability",
    "representative_ev_current",
    "ev_sales_multiple",
    "revenue_3y",
  ],
  "Composite Scenario": [
    "bull_probability",
    "base_probability",
    "bear_probability",
    "revenue_growth_3y_avg",
    "operating_margin",
    "net_financing_result",
    "tax_rate",
    "pe_multiple",
  ],
  "SOTP Scenario": [
    "bull_probability",
    "base_probability",
    "bear_probability",
    "target_market_cap",
  ],
  "Dream Team": [
    "target_market_cap",
  ],
};

const ACTIVE_SCENARIO_METHOD_NAMES = new Set([
  "Scenario DCF",
  "Target Scenario",
  "Earnings Scenario",
  "Revenue Scenario",
  "Composite Scenario",
  "SOTP Scenario",
  "Dream Team",
]);

type MethodMetricItem = {
  key: string;
  label: string;
  value: number;
};

export function buildCurrencyContext(data: DashboardPayload | null): CurrencyContext {
  const isIsraeli = String(data?.ticker || "").toUpperCase().endsWith(".TA");
  const priceCode = String(data?.header?.display_currency || data?.header?.currency || (isIsraeli ? "ILS" : "USD")).toUpperCase();
  const financialCode = String(data?.header?.original_financial_currency || priceCode || "USD").toUpperCase();
  return {
    code: priceCode,
    symbol: currencySymbol(priceCode),
    financialCode,
    financialSymbol: currencySymbol(financialCode),
    isIsraeli,
    // Dashboard numeric values are already emitted in display scale.
    // Do not apply an extra multiplier in the UI.
    priceUsdToDisplay: 1,
    financialUsdToDisplay: 1,
  };
}

function currencySymbol(code: string): string {
  const normalized = String(code || "").trim().toUpperCase();
  const symbols: Record<string, string> = {
    USD: "$",
    ILS: "₪",
    ILA: "₪",
    EUR: "€",
    GBP: "£",
    GBX: "£",
    JPY: "¥",
    CNY: "¥",
    CNH: "¥",
    KRW: "₩",
    INR: "₹",
    CAD: "C$",
    AUD: "A$",
    NZD: "NZ$",
    HKD: "HK$",
    SGD: "S$",
    CHF: "CHF",
    SEK: "kr",
    NOK: "kr",
    DKK: "kr",
    ZAR: "R",
    ZAC: "R",
    BRL: "R$",
    MXN: "Mex$",
    TRY: "₺",
  };
  return symbols[normalized] || `${normalized} `;
}

function toDisplayAmount(v: number, ctx: CurrencyContext, kind: "price" | "financial" = "price"): number {
  if (!Number.isFinite(v)) return v;
  const multiplier = kind === "financial" ? ctx.financialUsdToDisplay : ctx.priceUsdToDisplay;
  return v * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
}

export function fmtMoney(v: number | null | undefined, ctx: CurrencyContext, kind: "price" | "financial" = "price"): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const display = toDisplayAmount(v, ctx, kind);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: ctx.code,
      maximumFractionDigits: 2,
    }).format(display);
  } catch {
    return `${ctx.symbol}${display.toFixed(2)}`;
  }
}

function fmtPlainCompact(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
}

export function fmtMoneyCompact(v: number | null | undefined, ctx: CurrencyContext, kind: "price" | "financial" = "price"): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const display = toDisplayAmount(v, ctx, kind);
  if (kind === "financial") {
    return fmtPlainCompact(display);
  }
  const abs = Math.abs(display);
  const sign = display < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${ctx.symbol}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${ctx.symbol}${(abs / 1_000_000).toFixed(2)}M`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: ctx.code,
      maximumFractionDigits: 2,
    }).format(display);
  } catch {
    return `${sign}${ctx.symbol}${abs.toFixed(2)}`;
  }
}

export function fmtMarketCap(v: number | null | undefined, ctx: CurrencyContext): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const usdContext = { ...ctx, code: "USD", symbol: "$" };
  return fmtMoneyCompact(v, usdContext, "price");
}

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
const fmtScoreInputPctOnly = (v?: number | null) => {
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
const targetChangePctFromCurrent = (target?: number | null, current?: number | null): number | null => {
  if (
    typeof target !== "number" ||
    !Number.isFinite(target) ||
    typeof current !== "number" ||
    !Number.isFinite(current) ||
    Math.abs(current) <= 1e-9
  ) {
    return null;
  }
  return ((target - current) / current) * 100;
};
const tabToneFromTarget = (target?: number | null, current?: number | null): TabTone => {
  const changePct = targetChangePctFromCurrent(target, current);
  if (typeof changePct !== "number" || !Number.isFinite(changePct) || Math.abs(changePct) <= 1e-9) return "neutral";
  return changePct > 0 ? "up" : "down";
};
const fmtNotionalPct = (v?: number | null) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "N/A";
  const pct = (v / NOTIONAL_BASE_USD) * 100;
  if (Math.abs(pct) < 1e-9) return "0.00%";
  return `${pct.toFixed(2)}%`;
};
const fmtTargetOrFloor = (v: number | null | undefined, ctx: CurrencyContext) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "<0";
  return fmtMoneyCompact(v, ctx, "price");
};

function formatMethodMetric(metricKey: string, value: number | null | undefined, ctx: CurrencyContext): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  const normalizedKey = String(metricKey || "").trim().toLowerCase();
  if (PROBABILITY_METRIC_KEYS.has(normalizedKey)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (DECIMAL_PERCENT_METRIC_KEYS.has(normalizedKey)) {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (MONEY_METRIC_KEYS.has(normalizedKey)) {
    return fmtMoneyCompact(value, ctx, "financial");
  }
  return fmtLargeAware(value);
}

function formatAssumptionValue(label: string, value: number | null | undefined, ctx: CurrencyContext): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  const normalizedLabel = String(label || "").trim().toLowerCase();
  if (ASSUMPTION_MONEY_LABELS.has(normalizedLabel)) {
    return fmtFinancialCompact(value, ctx);
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return fmtNum(value);
}

function formatAssumptionCurrentValue(label: string, value: number | null | undefined, ctx: CurrencyContext): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return formatAssumptionValue(label, value, ctx);
}

function fmtFinancialCompact(value: number, ctx: CurrencyContext): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const prefix = `${sign}${ctx.financialSymbol}`;
  if (abs >= 1_000_000_000) return `${prefix}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: ctx.financialCode,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${prefix}${abs.toFixed(2)}`;
  }
}

function modelExplanation(modelName: string): string {
  return MODEL_EXPLANATIONS[String(modelName || "").trim()] || "This model adds another valuation lens so you can compare different ways of pricing the same business before scoring it.";
}

function stripBrokenMarkdownArtifacts(text: string): string {
  return String(text || "")
    .replace(/[\u0334\u0335\u0336\u0337\u0338]/g, "")
    .replace(/<\s*\/?\s*del\s*>/gi, "")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/~~/g, "");
}

function InlineMarkdown({ text }: { text: string }) {
  const cleaned = stripBrokenMarkdownArtifacts(String(text || ""))
    .replace(/\u200b/g, "")
    .trim();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <>{children}</>,
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );
}

function BulletList({ items, tone = "bull" }: { items: string[]; tone?: "bull" | "bear" }) {
  if (!items.length) return <p className="text-sm text-zinc-500">No items yet.</p>;
  const dotClass = tone === "bear" ? "bg-red-400" : "bg-emerald-400";
  return (
    <ul className="space-y-2 text-sm text-zinc-200">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 12)}`} className="flex gap-2">
          <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
          <span className="hib-inline-markdown">
            <InlineMarkdown text={item} />
          </span>
        </li>
      ))}
    </ul>
  );
}

type TabTone = "up" | "down" | "neutral";

function tabToneClass(tone: TabTone, active: boolean): string {
  if (tone === "up") {
    return active
      ? "border-emerald-500/60 bg-emerald-500/24 text-emerald-100"
      : "border-emerald-500/35 bg-emerald-500/8 text-zinc-300 hover:border-emerald-500/55";
  }
  if (tone === "down") {
    return active
      ? "border-red-500/60 bg-red-500/24 text-red-100"
      : "border-red-500/35 bg-red-500/8 text-zinc-300 hover:border-red-500/55";
  }
  return active
    ? "border-white/25 bg-white/10 text-zinc-100"
    : "border-white/15 bg-white/5 text-zinc-300 hover:border-white/35";
}

function Tab({
  active,
  onClick,
  label,
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: TabTone;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hib-tab rounded-lg border px-3 py-2 text-xs uppercase tracking-[0.14em] transition ${tabToneClass(tone, active)} ${
        active ? "ring-2 ring-sky-300/90 ring-offset-1 ring-offset-zinc-950 shadow-sm" : ""
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {active ? <span className="text-[10px] leading-none text-sky-200">●</span> : null}
        <span>{label}</span>
      </span>
    </button>
  );
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text || "").trim();
  if (!value) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fallback below for browsers that block clipboard API.
  }
  try {
    if (typeof document === "undefined") return false;
    const textArea = document.createElement("textarea");
    textArea.value = value;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    textArea.style.pointerEvents = "none";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textArea);
    return copied;
  } catch {
    return false;
  }
}

export function SmallCopyButton({
  text,
  label = "Copy text",
  className = "",
  iconOnly = false,
}: {
  text: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasText = String(text || "").trim().length > 0;

  useEffect(() => {
    if (!copied) return;
    const timerId = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timerId);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    if (!hasText || busy) return;
    setBusy(true);
    const ok = await copyTextToClipboard(text);
    setBusy(false);
    if (ok) setCopied(true);
  }, [busy, hasText, text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!hasText || busy}
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center border border-white/15 bg-white/5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-300 transition hover:border-white/35 hover:bg-white/10 hover:text-zinc-100 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-zinc-500 ${
        iconOnly ? "h-12 w-12 justify-center rounded-xl p-0" : "min-h-9 gap-1.5 rounded-xl px-3 py-2"
      } ${className}`}
    >
      {copied ? <Check size={iconOnly ? 16 : 12} /> : <Copy size={iconOnly ? 16 : 12} />}
      {iconOnly ? <span className="sr-only">{copied ? "Copied" : "Copy"}</span> : <span>{copied ? "Copied" : "Copy"}</span>}
    </button>
  );
}

function AutoFitMetric({
  text,
  className,
  maxPx,
  minPx,
}: {
  text: string;
  className?: string;
  maxPx: number;
  minPx: number;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.clientWidth) return;

    let size = maxPx;
    el.style.fontSize = `${size}px`;
    el.style.whiteSpace = "nowrap";

    while (size > minPx && el.scrollWidth > el.clientWidth + 1) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }

    while (size < maxPx) {
      const next = size + 1;
      el.style.fontSize = `${next}px`;
      if (el.scrollWidth <= el.clientWidth + 1) {
        size = next;
      } else {
        el.style.fontSize = `${size}px`;
        break;
      }
    }
  }, [maxPx, minPx]);

  useEffect(() => {
    fit();
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, text]);

  return (
    <p ref={ref} className={className}>
      {text}
    </p>
  );
}

export function MarkdownBlock({ text }: { text: string }) {
  const cleaned = stripBrokenMarkdownArtifacts(String(text || ""))
    .replace(/\u200b/g, "")
    .trim();
  return (
    <div className="hib-markdown text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
    </div>
  );
}

function splitMarkdownHeadingBlocks(title: string, text: string): Array<{ title: string; text: string }> {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } = { title, lines: [] };

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}#{2,4}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (current.lines.join("\n").trim()) {
        blocks.push(current);
      }
      current = { title: heading[1].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.join("\n").trim()) {
    blocks.push(current);
  }

  if (blocks.length === 0) {
    return [{ title, text: String(text || "").trim() }].filter((block) => block.text);
  }

  return blocks.map((block) => ({ title: block.title, text: block.lines.join("\n").trim() }));
}

function TradingAgentsPanel({ payload }: { payload?: DashboardPayload["trading_agents"] }) {
  if (!payload || !Object.keys(payload).length) {
    return <p className="mt-3 text-sm text-zinc-500">No TradingAgents lens was stored for this report.</p>;
  }

  const status = String(payload.status || "unavailable");
  const generatedAt = payload.generated_at ? fmtDateTimeNoSeconds(String(payload.generated_at)) : "N/A";
  const reusedAt = payload.reused_at ? fmtDateTimeNoSeconds(String(payload.reused_at)) : "";
  const statusText = payload.reused
    ? `Reused from ${generatedAt}${reusedAt ? `, copied ${reusedAt}` : ""}`
    : status === "success"
      ? `Generated fresh ${generatedAt}`
      : `Unavailable ${generatedAt}`;
  const sections = [
    ["Research Brief", payload.research_brief],
    ["Final Committee Decision", payload.final_committee_view],
    ["Fundamentals Report", payload.fundamentals_report],
    ["News Report", payload.news_report],
    ["Social / Sentiment Report", payload.sentiment_report],
    ["Bull/Bear Debate", payload.bull_bear_debate],
    ["Risk Debate", payload.risk_debate],
  ] as const;
  const renderedSections = sections.flatMap(([title, text]) => {
    const cleanText = String(text || "").trim();
    if (!cleanText) return [];
    return splitMarkdownHeadingBlocks(title, cleanText);
  });

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-100">Independent Multi-Agent Research Lens</p>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-zinc-300">
            {statusText}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          This is a separate research memo from a small agent team. It reads the business, recent news, and market
          sentiment, then stages bull, bear, and risk debates before a final committee view. The memo itself does not
          set the target price or score.
        </p>
        {status !== "success" && payload.error ? (
          <p className="mt-2 text-xs text-zinc-400">Reason: {payload.error}</p>
        ) : null}
      </div>

      {renderedSections.map((section, index) => {
        return (
          <details key={`${section.title}-${index}`} className="rounded-xl border border-white/10 bg-black/30 p-3" open={index === 0}>
            <summary className="cursor-pointer text-sm font-semibold text-zinc-100">{section.title}</summary>
            <div className="mt-2 max-h-[24rem] overflow-auto break-words text-zinc-200">
              <MarkdownBlock text={section.text} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [bubbleStyle, setBubbleStyle] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 280,
  });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const updateMobile = () => setIsMobile(window.matchMedia("(max-width: 639px)").matches);
    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, []);

  useEffect(() => {
    if (!open || isMobile || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const width = Math.min(320, Math.max(220, window.innerWidth - 24));
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    let top = rect.bottom + 10;
    if (top + 140 > window.innerHeight) {
      top = Math.max(12, rect.top - 150);
    }
    setBubbleStyle({ top, left, width });
  }, [open, isMobile]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (btnRef.current?.contains(target)) return;
      if (bubbleRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const cleaned = String(text || "").replace(/\u200b/g, "").replace(/~~/g, "").trim();

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => {
          if (!isMobile) setOpen(true);
        }}
        onMouseLeave={() => {
          if (!isMobile) setOpen(false);
        }}
        aria-label="More information"
        className="hib-info-tip-btn ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold leading-none"
      >
        i
      </button>
      {open && isMobile ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            ref={bubbleRef}
            className="hib-tooltip-panel w-full max-w-sm rounded-xl border px-3 py-2 text-left text-xs leading-relaxed shadow-2xl"
            dir="ltr"
            style={{ unicodeBidi: "isolate" }}
            onClick={(e) => e.stopPropagation()}
          >
            {cleaned}
          </div>
        </div>
      ) : null}
      {open && !isMobile ? (
        <div
          ref={bubbleRef}
          className="hib-tooltip-panel fixed z-[80] rounded-md border px-2 py-1 text-left text-[11px] normal-case leading-snug shadow-xl"
          dir="ltr"
          style={{ top: bubbleStyle.top, left: bubbleStyle.left, width: bubbleStyle.width, unicodeBidi: "isolate" }}
          onMouseLeave={() => setOpen(false)}
        >
          {cleaned}
        </div>
      ) : null}
    </span>
  );
}

export function prettyReasonLabel(label: string): string {
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
    .replace(/\bstep by step analysis(?:\s+analysis)+\b/g, "step by step analysis")
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
    "margin rationale": "EBIT Margin Rationale",
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

export function normalizeReasonText(text: string): string {
  const src = stripBrokenMarkdownArtifacts(String(text || "")).replace(/\r\n/g, "\n").trim();
  if (!src) return "";
  const mergedLines = src.replace(/([^\n])\n(?!\n)/g, "$1 ");
  return mergedLines
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function reportTimestamp(report: ReportListItem): number {
  const raw = String(report.generated_at || report.updated_at || "");
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

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

function fmtReportScore(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "N/A";
}

function reportScoreToneClass(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) <= 1e-9) return "text-zinc-300";
  return value > 0 ? "hib-target-up" : "hib-target-down";
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
  if (key.startsWith("weighted_activity_")) {
    const activity = key.replace(/^weighted_activity_/, "").replace(/_/g, " ").trim();
    return activity
      .split(" ")
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" ");
  }

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

function orderedMethodMetrics(methodName: string, keyMetricMeans: Record<string, number>): MethodMetricItem[] {
  const entries = Object.entries(keyMetricMeans || {}).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v),
  );
  if (!entries.length) return [];

  const preferredOrder = METHOD_METRIC_ORDER[String(methodName || "").trim()] || [];
  const entryMap = new Map(entries.map(([k, v]) => [String(k), Number(v)]));
  const orderedKeys: string[] = [];

  for (const key of preferredOrder) {
    if (entryMap.has(key)) orderedKeys.push(key);
  }
  for (const [key] of entries) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }

  return orderedKeys
    .map((key) => {
      const value = entryMap.get(key);
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      return { key, label: prettyMetricName(key), value };
    })
    .filter((row): row is MethodMetricItem => row !== null);
}

function investmentAmountToPct(investmentAmount?: number | null): number | null {
  if (typeof investmentAmount !== "number" || !Number.isFinite(investmentAmount)) return null;
  return (investmentAmount / NOTIONAL_BASE_USD) * 100;
}

function combinedScore(investmentAmount?: number | null, targetReturnPct?: number | null): number | null {
  const investmentScore = investmentAmountToPct(investmentAmount);
  const hasInvestment = typeof investmentScore === "number" && Number.isFinite(investmentScore);
  const hasTargetReturn = typeof targetReturnPct === "number" && Number.isFinite(targetReturnPct);
  if (!hasInvestment && !hasTargetReturn) return null;
  if (hasInvestment && hasTargetReturn) return (0.4 * Number(investmentScore)) + (0.6 * Number(targetReturnPct));
  return hasInvestment ? Number(investmentScore) : Number(targetReturnPct);
}

function confidenceAdjustedScore(baseScore?: number | null, overallCv?: number | null): number | null {
  if (typeof baseScore !== "number" || !Number.isFinite(baseScore)) return null;
  const cv = typeof overallCv === "number" && Number.isFinite(overallCv) ? Math.max(0, overallCv) : 0;
  const confidenceFactor = 1 / (1 + Math.pow(cv, 1.3));
  return baseScore * confidenceFactor;
}

export function HedgeDashboard({
  tickerOverride,
  reportIdOverride,
  forceMainTab,
  hideNavHeader = false,
  hideMainTabBar = false,
  hideScoreFooter = false,
  onReportChange,
  postHeaderSlot,
}: HedgeDashboardProps = {}) {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [tickers, setTickers] = useState<string[]>([]);
  const [selectedTicker, setSelectedTicker] = useState(() =>
    String(tickerOverride || "").toUpperCase(),
  );
  const [selectedReportId, setSelectedReportId] = useState(() => String(reportIdOverride || ""));
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [internalMainTab, setInternalMainTab] = useState<MainTab>("valuation");
  const mainTab: MainTab = forceMainTab ?? internalMainTab;
  const setMainTab = (next: MainTab) => {
    if (forceMainTab) return;
    setInternalMainTab(next);
  };
  const [valuationTab, setValuationTab] = useState("overview");
  const [outputTab, setOutputTab] = useState<Record<string, string>>({});
  const [showAssumptionsRangeMobile, setShowAssumptionsRangeMobile] = useState(false);
  const [liveCurrentPrice, setLiveCurrentPrice] = useState<number | null>(null);
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const reportPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tickerFromProp = String(tickerOverride || "").trim().toUpperCase();
    const reportFromProp = String(reportIdOverride || "").trim();
    const tickerFromUrl =
      tickerFromProp ||
      (typeof window !== "undefined"
        ? String(new URLSearchParams(window.location.search).get("ticker") || "")
            .trim()
            .toUpperCase()
        : "");
    const reportFromUrl =
      reportFromProp ||
      (typeof window !== "undefined"
        ? String(new URLSearchParams(window.location.search).get("report") || "").trim()
        : "");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep selection in sync with route-driven props
  useEffect(() => {
    if (tickerOverride !== undefined) {
      const next = String(tickerOverride || "").toUpperCase();
      setSelectedTicker((prev) => (prev === next ? prev : next));
      if (next) setLoading(true);
    }
  }, [tickerOverride]);

  useEffect(() => {
    if (reportIdOverride !== undefined) {
      setSelectedReportId((prev) => (prev === reportIdOverride ? prev : String(reportIdOverride || "")));
    }
  }, [reportIdOverride]);

  const reportsForSelectedTicker = useMemo(
    () =>
      reports
        .filter((r) => String(r.ticker || "").toUpperCase() === String(selectedTicker || "").toUpperCase())
        .sort((a, b) => reportTimestamp(b) - reportTimestamp(a)),
    [reports, selectedTicker],
  );

  useEffect(() => {
    if (!reportPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (reportPickerRef.current && !reportPickerRef.current.contains(e.target as Node)) setReportPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReportPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [reportPickerOpen]);
  const currentReportId =
    selectedTicker && reportsForSelectedTicker.length
      ? reportsForSelectedTicker.some((r) => r.report_id === selectedReportId)
        ? selectedReportId
        : reportsForSelectedTicker[0].report_id
      : "";

  useEffect(() => {
    if (!onReportChange) return;
    if (!currentReportId) return;
    onReportChange(currentReportId);
  }, [currentReportId, onReportChange]);

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

  useEffect(() => {
    if (!selectedTicker) return;
    const controller = new AbortController();
    fetch(`/api/performance/${encodeURIComponent(selectedTicker)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((json) => {
        const next =
          typeof json?.current_price === "number" && Number.isFinite(json.current_price)
            ? Number(json.current_price)
            : null;
        setLiveCurrentPrice(next);
      })
      .catch(() => {
        setLiveCurrentPrice(null);
      });
    return () => controller.abort();
  }, [selectedTicker]);

  const currencyContext = useMemo(() => buildCurrencyContext(data), [data]);
  const consensus = data?.valuation_hub?.consensus;
  const methodTabs = useMemo(() => {
    const rawTabs = Array.isArray(data?.valuation_hub?.method_tabs) ? data.valuation_hub.method_tabs : [];
    const normalized = rawTabs.map((tab) => ({
      ...tab,
      name: canonicalModelName(String(tab.name || "").trim()),
    }));
    const hasScenarioSet = normalized.some((tab) => ACTIVE_SCENARIO_METHOD_NAMES.has(tab.name));
    const filtered = hasScenarioSet
      ? normalized.filter((tab) => ACTIVE_SCENARIO_METHOD_NAMES.has(tab.name))
      : normalized;
    const deduped = new Map<string, DashboardMethodTab>();
    for (const tab of filtered) {
      const existing = deduped.get(tab.name);
      if (!existing) {
        deduped.set(tab.name, tab);
        continue;
      }
      const existingScore =
        (Array.isArray(existing.outputs) ? existing.outputs.length : 0) +
        Object.keys(existing.key_metric_means || {}).length;
      const nextScore =
        (Array.isArray(tab.outputs) ? tab.outputs.length : 0) +
        Object.keys(tab.key_metric_means || {}).length;
      if (nextScore > existingScore) {
        deduped.set(tab.name, tab);
      }
    }
    const order = [
      "Scenario DCF",
      "Target Scenario",
      "Earnings Scenario",
      "Revenue Scenario",
      "Composite Scenario",
      "SOTP Scenario",
      "Dream Team",
    ];
    return Array.from(deduped.values()).sort((a, b) => {
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [data?.valuation_hub?.method_tabs]);
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
  const activeMethod: DashboardMethodTab | null = methodTabs.find((m) => m.name === valuationTab) || null;
  const tradingAgentsPayload = data?.trading_agents;
  const hasTradingAgents =
    !!tradingAgentsPayload &&
    (Object.keys(tradingAgentsPayload).length > 0 || String(tradingAgentsPayload.status || "").trim().length > 0);
  const selectedOutput = activeMethod
    ? activeMethod.outputs.find((o) => (o.persona || `Output ${o.output_id}`) === outputTab[activeMethod.name]) || activeMethod.outputs[0]
    : null;
  const activeMethodMetricItems = useMemo(
    () => orderedMethodMetrics(activeMethod?.name || "", activeMethod?.key_metric_means || {}),
    [activeMethod?.name, activeMethod?.key_metric_means],
  );
  const activeMethodProbabilityItems = useMemo(
    () => activeMethodMetricItems.filter((item) => PROBABILITY_METRIC_KEYS.has(String(item.key || "").toLowerCase())),
    [activeMethodMetricItems],
  );
  const activeMethodOtherMetricItems = useMemo(
    () =>
      activeMethodMetricItems.filter(
        (item) => !PROBABILITY_METRIC_KEYS.has(String(item.key || "").toLowerCase()),
      ),
    [activeMethodMetricItems],
  );
  const consensusCurrent =
    typeof consensus?.current_price === "number" && Number.isFinite(consensus.current_price)
      ? Number(consensus.current_price)
      : null;
  const consensusMean =
    typeof consensus?.mean_target_price === "number" && Number.isFinite(consensus.mean_target_price)
      ? Number(consensus.mean_target_price)
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
  const activeMethodTargetChangePct =
    typeof activeMethod?.target_price === "number" &&
    Number.isFinite(activeMethod.target_price) &&
    typeof consensusCurrent === "number" &&
    Number.isFinite(consensusCurrent) &&
    Math.abs(consensusCurrent) > 1e-9
      ? ((activeMethod.target_price - consensusCurrent) / consensusCurrent) * 100
      : null;
  const selectedOutputTargetChangePct =
    typeof selectedOutput?.target_price === "number" &&
    Number.isFinite(selectedOutput.target_price) &&
    typeof consensusCurrent === "number" &&
    Number.isFinite(consensusCurrent) &&
    Math.abs(consensusCurrent) > 1e-9
      ? ((selectedOutput.target_price - consensusCurrent) / consensusCurrent) * 100
      : null;
  const activeMethodTargetChangeClass = toneClassFromSign(activeMethodTargetChangePct);
  const selectedOutputTargetChangeClass = toneClassFromSign(selectedOutputTargetChangePct);
  const consensusMeanClass = toneClassFromTarget(consensusMean, consensusCurrent);
  const consensusChangeClass = toneClassFromSign(consensusChangePct);
  const consensusMeanText = fmtTargetOrFloor(consensus?.mean_target_price, currencyContext);
  const consensusCurrentText = fmtMoneyCompact(consensus?.current_price, currencyContext, "price");
  const consensusChangeText = typeof consensusChangePct === "number" ? fmtPct(consensusChangePct) : "N/A";
  const overallDisagreement =
    [consensusCvRaw, lmilCvRaw].filter((v): v is number => typeof v === "number" && Number.isFinite(v)).length > 0
      ? avg([consensusCvRaw, lmilCvRaw].filter((v): v is number => typeof v === "number" && Number.isFinite(v)))
      : null;
  const targetTableRows = useMemo(() => {
    const currentPrice =
      typeof consensus?.current_price === "number" && Number.isFinite(consensus.current_price)
        ? Number(consensus.current_price)
        : null;
    const rawBlocks = Array.isArray(data?.valuation_hub?.method_blocks) ? data.valuation_hub.method_blocks : [];
    const normalizedBlocks = rawBlocks.map((b) => ({
      ...b,
      name: canonicalModelName(String(b.name || "").trim()),
    }));
    const hasScenarioSet = normalizedBlocks.some((b) => ACTIVE_SCENARIO_METHOD_NAMES.has(String(b.name || "")));
    const filteredBlocks = hasScenarioSet
      ? normalizedBlocks.filter((b) => ACTIVE_SCENARIO_METHOD_NAMES.has(String(b.name || "")))
      : normalizedBlocks;
    const dedupedBlocks = new Map<string, (typeof filteredBlocks)[number]>();
    for (const block of filteredBlocks) {
      const key = String(block.name || "").trim();
      if (!key) continue;
      const existing = dedupedBlocks.get(key);
      if (!existing) {
        dedupedBlocks.set(key, block);
        continue;
      }
      const existingScore =
        (typeof existing.target_price === "number" && Number.isFinite(existing.target_price) ? 1 : 0) +
        (typeof existing.investment_amount === "number" && Number.isFinite(existing.investment_amount) ? 1 : 0);
      const nextScore =
        (typeof block.target_price === "number" && Number.isFinite(block.target_price) ? 1 : 0) +
        (typeof block.investment_amount === "number" && Number.isFinite(block.investment_amount) ? 1 : 0);
      if (nextScore > existingScore) {
        dedupedBlocks.set(key, block);
      }
    }
    const rows = Array.from(dedupedBlocks.values()).map((b) => {
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
        combinedScore: combinedScore(b.investment_amount, changePct),
      };
    });
    return rows.sort((a, b) => {
      const at = typeof a.target === "number" ? a.target : Number.NEGATIVE_INFINITY;
      const bt = typeof b.target === "number" ? b.target : Number.NEGATIVE_INFINITY;
      if (bt !== at) return bt - at;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [consensus, data?.valuation_hub?.method_blocks]);
  const dreamTeamTableRows = useMemo(() => {
    const currentPrice =
      typeof consensus?.current_price === "number" && Number.isFinite(consensus.current_price)
        ? Number(consensus.current_price)
        : null;
    return (data?.dream_team || [])
      .map((member, idx) => {
        const target =
          typeof member.target_price === "number" && Number.isFinite(Number(member.target_price))
            ? Number(member.target_price)
            : null;
        const investment =
          typeof member.investment_amount === "number" && Number.isFinite(Number(member.investment_amount))
            ? Number(member.investment_amount)
            : null;
        const changePct = targetChangePctFromCurrent(target, currentPrice);
        return {
          name: String(member.persona || `Valuator ${idx + 1}`).trim(),
          target,
          investment,
          changePct,
          combinedScore: combinedScore(investment, changePct),
        };
      })
      .filter((row) => row.name)
      .sort((a, b) => {
        const at = typeof a.target === "number" ? a.target : Number.NEGATIVE_INFINITY;
        const bt = typeof b.target === "number" ? b.target : Number.NEGATIVE_INFINITY;
        if (bt !== at) return bt - at;
        return String(a.name).localeCompare(String(b.name));
      });
  }, [consensus?.current_price, data?.dream_team]);
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
      ? fmtDateTimeNoSeconds(String(data?.generated_at || data?.report_mtime))
      : "N/A";
  const reportDateIso =
    data?.generated_at || data?.report_mtime
      ? new Date(String(data?.generated_at || data?.report_mtime)).toISOString().slice(0, 10)
      : "N/A";
  const analysisDurationText =
    typeof data?.analysis_duration_minutes === "number" && Number.isFinite(data.analysis_duration_minutes)
      ? `${data.analysis_duration_minutes.toFixed(1)} min`
      : "N/A";
  const assumptionsModelRows = useMemo(() => {
    const sourceRows = data?.valuation_hub.all_values?.metric_means || [];
    const rows: typeof sourceRows = [];
    const hasBlendedProbabilities = sourceRows.some((row) => {
      const mk = String(row.metric_key || "").trim().toLowerCase();
      return mk === "bull_probability_blended" || mk === "base_probability_blended" || mk === "bear_probability_blended";
    });
    const mergeBuckets: Record<
      string,
      {
        label: string;
        metric_key: string;
        items: typeof sourceRows;
      }
    > = {
      predicted_ev_sales: {
        label: "Representative EV/Sales",
        metric_key: "predicted_ev_sales",
        items: [],
      },
      predicted_fcf_next_year: {
        label: "Representative FCF",
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
        hasBlendedProbabilities &&
        (normalized === "base 0" || normalized === "bear 0" || normalized === "bull 0")
      ) {
        // Prefer explicit blended probability rows when present.
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
          : normalized === "predicted revenue"
          ? "Representative Revenue"
          : normalized === "predicted ev sales"
          ? "Representative EV/Sales"
          : normalized === "predicted earnings"
          ? "Representative Earnings"
          : normalized === "predicted p e"
          ? "Representative P/E"
          : normalized === "predicted fcf next year"
          ? "Representative FCF"
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
        current_value: null,
      });
    }
    return rows;
  }, [data?.valuation_hub.all_values?.metric_means]);

  const assumptionCurrentValues = useMemo(() => {
    const raw = data?.valuation_hub.all_values?.assumption_current_values || {};
    return raw && typeof raw === "object" ? raw : {};
  }, [data?.valuation_hub.all_values?.assumption_current_values]);

  const currentAssumptionValue = useCallback(
    (label: string) => {
      const normalized = normalizeMetricLabel(label);
      const key =
        normalized === "representative fcf"
          ? "representative_fcf"
          : normalized === "representative revenue"
            ? "representative_revenue"
            : normalized === "representative ev sales"
              ? "representative_ev_sales"
              : normalized === "representative earnings"
                ? "representative_earnings"
                : normalized === "representative p e"
                  ? "representative_pe"
                  : "";
      if (!key) return null;
      const raw = assumptionCurrentValues[key as keyof typeof assumptionCurrentValues];
      const value = typeof raw === "number" ? raw : null;
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    },
    [assumptionCurrentValues],
  );

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
      "Representative FCF",
      "Terminal Value Growth",
      "WACC",
      "",
      "Representative Revenue",
      "Representative EV/Sales",
      "Representative Earnings",
      "Representative P/E",
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
  const executiveSummaryCopyText = normalizeReasonText(String(data?.analysis_matrix?.executive_summary_markdown || ""));
  const bullCopyText = [
    `Bull Probability: ${fmtProbability(bullProbability)}`,
    "",
    ...bullReasons.map((item, idx) => `${idx + 1}. ${normalizeReasonText(String(item || ""))}`),
  ].join("\n").trim();
  const bearCopyText = [
    `Bear Probability: ${fmtProbability(bearProbability)}`,
    "",
    ...bearReasons.map((item, idx) => `${idx + 1}. ${normalizeReasonText(String(item || ""))}`),
  ].join("\n").trim();
  const scoreCard = data?.score_card || data?.decision_card || {};
  const meanAllocationPct =
    typeof scoreCard?.position_size_pct_of_notional === "number" &&
    Number.isFinite(scoreCard.position_size_pct_of_notional)
      ? Number(scoreCard.position_size_pct_of_notional)
      : typeof scoreCard?.mean_investment_amount === "number" && Number.isFinite(scoreCard.mean_investment_amount)
        ? Number(scoreCard.mean_investment_amount) / NOTIONAL_BASE_USD * 100
        : null;
  const finalCombinedScore =
    typeof scoreCard?.combined_score === "number" && Number.isFinite(scoreCard.combined_score)
      ? Number(scoreCard.combined_score)
      : combinedScore(scoreCard?.mean_investment_amount, consensusChangePct);
  const finalAdjustedScore =
    typeof scoreCard?.adjusted_score === "number" && Number.isFinite(scoreCard.adjusted_score)
      ? Number(scoreCard.adjusted_score)
      : confidenceAdjustedScore(finalCombinedScore, overallDisagreement);
  const scoreToneClass = toneClassFromSign(finalAdjustedScore);
  const openMethodTab = (methodName: string, outputName?: string) => {
    const cleanMethod = String(methodName || "").trim();
    if (!cleanMethod) return;
    setValuationTab(cleanMethod);
    if (outputName) {
      setOutputTab((prev) => ({ ...prev, [cleanMethod]: outputName }));
    }
  };

  return (
    <div className={hideNavHeader ? "min-h-full" : "hib-shell min-h-screen"}>
      <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-6 sm:px-8">
        {!hideNavHeader ? (
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
        ) : null}

        {reportsForSelectedTicker.length > 1 ? (
          <section className="mb-4 rounded-xl border border-white/10 bg-zinc-950/70 p-3">
            <div className="relative" ref={reportPickerRef}>
              <button
                type="button"
                onClick={() => setReportPickerOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1.5 text-[11px] font-medium text-zinc-300 backdrop-blur transition hover:border-white/30 hover:text-zinc-100"
                aria-haspopup="listbox"
                aria-expanded={reportPickerOpen}
              >
                <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">{selectedTicker} · Report</span>
                <span className="font-mono text-[11px] text-zinc-100">
                  {fmtDateTimeNoSeconds(
                    String(
                      (reportsForSelectedTicker.find((r) => r.report_id === currentReportId) || reportsForSelectedTicker[0])
                        ?.generated_at ||
                        (reportsForSelectedTicker.find((r) => r.report_id === currentReportId) || reportsForSelectedTicker[0])
                          ?.updated_at ||
                        "",
                    ),
                  )}
                </span>
                <span
                  className={`font-mono text-[11px] font-semibold ${reportScoreToneClass(
                    (reportsForSelectedTicker.find((r) => r.report_id === currentReportId) || reportsForSelectedTicker[0])?.score,
                  )}`}
                >
                  Score{" "}
                  {fmtReportScore(
                    (reportsForSelectedTicker.find((r) => r.report_id === currentReportId) || reportsForSelectedTicker[0])?.score,
                  )}
                </span>
                <ChevronDown size={12} className={`transition ${reportPickerOpen ? "rotate-180" : ""}`} />
              </button>
              {reportPickerOpen ? (
                <div
                  role="listbox"
                  className="absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/95 p-1 shadow-2xl backdrop-blur"
                >
                  {reportsForSelectedTicker.map((report) => {
                    const active = report.report_id === currentReportId;
                    return (
                      <button
                        key={report.report_id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setLoading(true);
                          setSelectedReportId(report.report_id);
                          setReportPickerOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition ${
                          active
                            ? "bg-emerald-500/10 text-emerald-100"
                            : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
                        }`}
                      >
                        <span className="font-mono">{fmtDateTimeNoSeconds(String(report.generated_at || report.updated_at || ""))}</span>
                        <span className={`font-mono font-semibold ${reportScoreToneClass(report.score)}`}>
                          {fmtReportScore(report.score)}
                        </span>
                        {active ? <Check size={13} className="text-emerald-300" aria-hidden /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">Newest to oldest</div>
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
                  <span className="block sm:inline">Report Date: {reportDateText}</span>
                  <span className="block sm:inline sm:ml-1">Analysis Duration: {analysisDurationText}</span>
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-white/10 bg-black/35 p-2">
                    <p className="text-zinc-500">
                      <span>Price</span>
                      <span className="block sm:ml-1 sm:inline">({reportDateIso})</span>
                    </p>
                    <p>{fmtMoney(data.header.current_price, currencyContext, "price")}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/35 p-2">
                    <p className="text-zinc-500">
                      <span>Market Cap</span>
                      <span className="block sm:ml-1 sm:inline">({reportDateIso})</span>
                    </p>
                    <p>{fmtMarketCap(data.header.market_cap, currencyContext)}</p>
                  </div>
                </div>
              </article>
            </section>

            {postHeaderSlot}

            {!hideMainTabBar ? (
              <section className="mb-4 flex flex-wrap gap-2">
                <Tab active={mainTab === "valuation"} onClick={() => setMainTab("valuation")} label="Valuation Engine" />
                <Tab active={mainTab === "executive"} onClick={() => setMainTab("executive")} label="Executive Summary" />
                <Tab active={mainTab === "bull"} onClick={() => setMainTab("bull")} label="Bull Case" />
                <Tab active={mainTab === "bear"} onClick={() => setMainTab("bear")} label="Bear Case" />
                <Tab active={mainTab === "values"} onClick={() => setMainTab("values")} label="Assumptions" />
              </section>
            ) : null}

            {mainTab === "valuation" ? (
              <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-100">Main Results</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="min-w-0 rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200">Mean Target Price</p>
                      <AutoFitMetric
                        text={consensusMeanText}
                        maxPx={42}
                        minPx={16}
                        className={`hib-metric-value mt-1 font-bold leading-tight ${consensusMeanClass}`}
                      />
                    </div>
                    <div className="min-w-0 rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200">
                        Price <span className="whitespace-nowrap">({reportDateIso})</span>
                      </p>
                      <AutoFitMetric
                        text={consensusCurrentText}
                        maxPx={42}
                        minPx={16}
                        className="hib-metric-value hib-current-price mt-1 font-bold leading-tight"
                      />
                    </div>
                    <div className="min-w-0 rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200">Change (%)</p>
                      <AutoFitMetric
                        text={consensusChangeText}
                        maxPx={32}
                        minPx={14}
                        className={`hib-metric-subvalue mt-1 font-bold leading-tight ${consensusChangeClass}`}
                      />
                    </div>
                    <div className="min-w-0 rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200">Mean Allocation (%)</p>
                      <AutoFitMetric
                        text={fmtScoreInputPctOnly(meanAllocationPct)}
                        maxPx={32}
                        minPx={14}
                        className={`hib-metric-subvalue mt-1 font-bold leading-tight ${toneClassFromSign(meanAllocationPct)}`}
                      />
                    </div>
                    <div className="min-w-0 rounded-lg border border-white/10 bg-black/25 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-200">Disagreement Score</p>
                      <AutoFitMetric
                        text={typeof overallDisagreement === "number" ? fmtNum(overallDisagreement) : "N/A"}
                        maxPx={32}
                        minPx={14}
                        className="hib-metric-subvalue mt-1 font-bold leading-tight text-zinc-100"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Tab active={valuationTab === "overview"} onClick={() => setValuationTab("overview")} label="Overview" />
                  {methodTabs.map((m) => (
                    <Tab
                      key={m.name}
                      active={valuationTab === m.name}
                      onClick={() => setValuationTab(m.name)}
                      label={m.name}
                      tone={tabToneFromTarget(m.target_price, consensusCurrent)}
                    />
                  ))}
                  {hasTradingAgents ? (
                    <Tab active={valuationTab === "trading-agents"} onClick={() => setValuationTab("trading-agents")} label="TradingAgents" />
                  ) : null}
                </div>
                {valuationTab === "overview" ? (
                  <div className="mt-3">
                    <div className="mb-2 px-1 text-xs text-zinc-400">
                      Price table
                    </div>
                    <div className="space-y-2 sm:hidden">
                      {targetTableRows.map((row) => {
                        const rowAdjustedScore = confidenceAdjustedScore(row.combinedScore, overallDisagreement);
                        const hasMethodTab = methodTabs.some((m) => m.name === row.name);
                        return (
                          <article key={`${row.name}-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
                            <button
                              type="button"
                              onClick={() => hasMethodTab && openMethodTab(row.name)}
                              disabled={!hasMethodTab}
                              className="text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-300 transition hover:text-zinc-100 disabled:cursor-default disabled:hover:text-zinc-300"
                            >
                              {row.name}
                            </button>
                            <p className={`mt-1 text-xl font-bold ${toneClassFromTarget(row.target, consensusCurrent)}`}>
                              {fmtTargetOrFloor(row.target, currencyContext)}
                            </p>
                            <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                              <span className={`font-semibold ${toneClassFromSign(row.changePct)}`}>
                                {typeof row.changePct === "number" ? fmtPct(row.changePct) : "-"}
                              </span>
                              <span className={`font-semibold ${toneClassFromSign(row.investment)}`}>
                                {fmtNotionalPct(row.investment)}
                              </span>
                            </div>
                            <p className={`mt-1 text-xs font-semibold ${toneClassFromSign(rowAdjustedScore)}`}>
                              Score {typeof rowAdjustedScore === "number" && Number.isFinite(rowAdjustedScore) ? rowAdjustedScore.toFixed(2) : "N/A"}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/30">
                    <table className="hidden w-full min-w-[640px] text-sm sm:table">
                      <thead className="border-b border-white/10 text-zinc-400">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Model Name</th>
                          <th className="px-3 py-2 text-right font-medium">Target Price</th>
                          <th className="px-3 py-2 text-right font-medium">Change vs Current</th>
                          <th className="px-3 py-2 text-right font-medium" dir="ltr" style={{ unicodeBidi: "isolate" }}>
                            <span dir="ltr" style={{ unicodeBidi: "isolate" }} className="inline-flex items-center gap-1">
                              <span>Investment %</span>
                              <InfoTip text="This is the total amount the model chose to invest in the stock (negative means a short position)." />
                            </span>
                          </th>
                          <th className="px-3 py-2 text-right font-medium">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {targetTableRows.map((row) => {
                          const rowAdjustedScore = confidenceAdjustedScore(row.combinedScore, overallDisagreement);
                          const hasMethodTab = methodTabs.some((m) => m.name === row.name);
                          return (
                          <tr key={row.name} className="border-b border-white/5 text-xs sm:text-sm">
                            <td className="px-3 py-2 font-medium text-zinc-200">
                              <button
                                type="button"
                                onClick={() => hasMethodTab && openMethodTab(row.name)}
                                disabled={!hasMethodTab}
                                className="font-semibold text-zinc-200 underline-offset-4 transition hover:text-zinc-100 hover:underline disabled:cursor-default disabled:no-underline disabled:hover:text-zinc-200"
                              >
                                {row.name}
                              </button>
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold ${toneClassFromTarget(row.target, consensusCurrent)}`}>
                              {fmtTargetOrFloor(row.target, currencyContext)}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold ${toneClassFromSign(row.changePct)}`}>
                              {typeof row.changePct === "number" ? fmtPct(row.changePct) : "-"}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold ${toneClassFromSign(row.investment)}`}>
                              {fmtNotionalPct(row.investment)}
                            </td>
                            <td className={`px-3 py-2 text-right font-semibold ${toneClassFromSign(rowAdjustedScore)}`}>
                              {typeof rowAdjustedScore === "number" && Number.isFinite(rowAdjustedScore) ? rowAdjustedScore.toFixed(2) : "N/A"}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                    {dreamTeamTableRows.length ? (
                      <div className="mt-5">
                        <div className="mb-2 px-1 text-xs text-zinc-400">
                          Dream Team table
                        </div>
                        <div className="space-y-2 sm:hidden">
                          {dreamTeamTableRows.map((row) => {
                            const rowAdjustedScore = confidenceAdjustedScore(row.combinedScore, overallDisagreement);
                            return (
                              <article key={`${row.name}-dream-mobile`} className="rounded-xl border border-white/10 bg-black/30 p-3">
                                <button
                                  type="button"
                                  onClick={() => openMethodTab("Dream Team", row.name)}
                                  className="text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-300 transition hover:text-zinc-100"
                                >
                                  {row.name}
                                </button>
                                <p className={`mt-1 text-xl font-bold ${toneClassFromTarget(row.target, consensusCurrent)}`}>
                                  {fmtTargetOrFloor(row.target, currencyContext)}
                                </p>
                                <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                                  <span className={`font-semibold ${toneClassFromSign(row.changePct)}`}>
                                    {typeof row.changePct === "number" ? fmtPct(row.changePct) : "-"}
                                  </span>
                                  <span className={`font-semibold ${toneClassFromSign(row.investment)}`}>
                                    {fmtNotionalPct(row.investment)}
                                  </span>
                                </div>
                                <p className={`mt-1 text-xs font-semibold ${toneClassFromSign(rowAdjustedScore)}`}>
                                  Score {typeof rowAdjustedScore === "number" && Number.isFinite(rowAdjustedScore) ? rowAdjustedScore.toFixed(2) : "N/A"}
                                </p>
                              </article>
                            );
                          })}
                        </div>
                        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/30">
                          <table className="hidden w-full min-w-[640px] text-sm sm:table">
                            <thead className="border-b border-white/10 text-zinc-400">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium">Valuator Name</th>
                                <th className="px-3 py-2 text-right font-medium">Target Price</th>
                                <th className="px-3 py-2 text-right font-medium">Change vs Current</th>
                                <th className="px-3 py-2 text-right font-medium">Investment %</th>
                                <th className="px-3 py-2 text-right font-medium">Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dreamTeamTableRows.map((row) => {
                                const rowAdjustedScore = confidenceAdjustedScore(row.combinedScore, overallDisagreement);
                                return (
                                  <tr key={`${row.name}-dream`} className="border-b border-white/5 text-xs sm:text-sm">
                                    <td className="px-3 py-2 font-medium text-zinc-200">
                                      <button
                                        type="button"
                                        onClick={() => openMethodTab("Dream Team", row.name)}
                                        className="font-semibold text-zinc-200 underline-offset-4 transition hover:text-zinc-100 hover:underline"
                                      >
                                        {row.name}
                                      </button>
                                    </td>
                                    <td className={`px-3 py-2 text-right font-semibold ${toneClassFromTarget(row.target, consensusCurrent)}`}>
                                      {fmtTargetOrFloor(row.target, currencyContext)}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-semibold ${toneClassFromSign(row.changePct)}`}>
                                      {typeof row.changePct === "number" ? fmtPct(row.changePct) : "-"}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-semibold ${toneClassFromSign(row.investment)}`}>
                                      {fmtNotionalPct(row.investment)}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-semibold ${toneClassFromSign(rowAdjustedScore)}`}>
                                      {typeof rowAdjustedScore === "number" && Number.isFinite(rowAdjustedScore) ? rowAdjustedScore.toFixed(2) : "N/A"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : valuationTab === "trading-agents" ? (
                  <TradingAgentsPanel payload={tradingAgentsPayload} />
                ) : activeMethod ? (
                  <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.2fr]">
                    <article className="rounded-xl border border-white/10 bg-black/35 p-3">
                      <p className="font-semibold">{activeMethod.name}</p>
                      <p className="text-sm text-zinc-400">
                        Mean Target: <span className={`font-semibold ${activeMethodTargetClass}`}>{fmtTargetOrFloor(activeMethod.target_price, currencyContext)}</span>{" "}
                        <span className={`text-xs font-semibold ${activeMethodTargetChangeClass}`}>
                          ({typeof activeMethodTargetChangePct === "number" ? fmtPct(activeMethodTargetChangePct) : "N/A"})
                        </span>{" "}
                      </p>
                      <p className="text-sm text-zinc-400">
                        Mean Investment: <span className={`font-semibold ${activeMethodInvestmentClass}`}>{fmtNotionalPct(activeMethod.investment_amount)}</span>{" "}
                      </p>
                      {[...activeMethodProbabilityItems, ...activeMethodOtherMetricItems].map((item) => (
                        <p key={item.key} className="text-xs text-zinc-500">
                          {item.label}: {formatMethodMetric(item.key, item.value, currencyContext)}
                        </p>
                      ))}
                      <p className="mt-3 rounded border border-white/10 bg-black/30 p-2 text-xs leading-relaxed text-zinc-300">
                        {modelExplanation(activeMethod.name)}
                      </p>
                      {activeMethod.name === "Dream Team" ? (
                        <p className="mt-3 rounded border border-white/10 bg-black/30 p-2 text-xs font-semibold leading-relaxed text-zinc-200">
                          These views are AI-generated representations of well-known investors&apos; thinking styles, not their actual opinions.
                        </p>
                      ) : null}
                    </article>
                    <article className="rounded-xl border border-white/10 bg-black/35 p-3">
                      {activeMethod.outputs.length ? (
                        <>
                          <div className="mb-2 flex flex-wrap gap-2">
                            {activeMethod.outputs.map((o) => {
                              const key = o.persona || `Output ${o.output_id}`;
                              const activeKey = outputTab[activeMethod.name] || (activeMethod.outputs[0].persona || `Output ${activeMethod.outputs[0].output_id}`);
                              return (
                                <Tab
                                  key={key}
                                  active={activeKey === key}
                                  onClick={() => setOutputTab((p) => ({ ...p, [activeMethod.name]: key }))}
                                  label={key}
                                  tone={tabToneFromTarget(o.target_price, consensusCurrent)}
                                />
                              );
                            })}
                          </div>
                          {selectedOutput ? (
                            <>
                              <div className="space-y-1 text-sm text-zinc-400">
                                <p>
                                  Target: <span className={`font-semibold ${selectedOutputTargetClass}`}>{fmtTargetOrFloor(selectedOutput.target_price, currencyContext)}</span>{" "}
                                  <span className={`text-xs font-semibold ${selectedOutputTargetChangeClass}`}>
                                    ({typeof selectedOutputTargetChangePct === "number" ? fmtPct(selectedOutputTargetChangePct) : "N/A"})
                                  </span>{" "}
                                </p>
                                <p>
                                  Investment: <span className={`font-semibold ${selectedOutputInvestmentClass}`}>{fmtNotionalPct(selectedOutput.investment_amount)}</span>{" "}
                                </p>
                              </div>
                              <div className="mt-2 max-h-[28rem] overflow-auto text-sm text-zinc-200">
                                {selectedOutput.reason_sections.length ? (
                                  selectedOutput.reason_sections.map((r) => (
                                    <details key={r.path} className="mb-2 rounded border border-white/10 bg-black/30 p-3" open>
                                      <summary className="cursor-pointer font-medium">{prettyReasonLabel(r.label)}</summary>
                                      <div className="mt-2">
                                        <MarkdownBlock text={normalizeReasonText(r.text)} />
                                      </div>
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

            {mainTab === "executive" ? (
              <section className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <div className="mb-3 flex justify-end">
                  <SmallCopyButton text={executiveSummaryCopyText} label="Copy execution summary" />
                </div>
                <MarkdownBlock text={data.analysis_matrix.executive_summary_markdown || ""} />
              </section>
            ) : null}
            {mainTab === "bull" ? (
              <section className="mb-6 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4">
                <div className="mb-3 flex justify-end">
                  <SmallCopyButton text={bullCopyText} label="Copy bull dashboard" />
                </div>
                <div className="mb-4 rounded-xl border border-emerald-400/35 bg-emerald-400/10 p-3">
                  <p className="hib-bull-prob-label text-xs uppercase tracking-[0.14em]">Bull Probability</p>
                  <p className="hib-bull-prob-value text-2xl font-semibold">{fmtProbability(bullProbability)}</p>
                </div>
                <BulletList items={bullReasons} tone="bull" />
              </section>
            ) : null}
            {mainTab === "bear" ? (
              <section className="mb-6 rounded-2xl border border-red-500/35 bg-red-500/10 p-4">
                <div className="mb-3 flex justify-end">
                  <SmallCopyButton text={bearCopyText} label="Copy bear dashboard" />
                </div>
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
                {showAssumptionsRangeMobile ? (
                  <div className="space-y-2 sm:hidden">
                    {assumptionsDisplayRows.map((entry) =>
                      entry?.type === "spacer" ? (
                        <div key={entry.key} className="h-2" />
                      ) : entry?.type === "metric" ? (
                        <article key={entry.key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                          <p className="text-sm font-semibold text-zinc-100">{entry.row.label}</p>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="uppercase tracking-[0.12em] text-zinc-500">Mean</p>
                              <p className="mt-1 font-mono text-zinc-100">{formatAssumptionValue(entry.row.label, entry.row.mean, currencyContext)}</p>
                            </div>
                            <div>
                              <p className="uppercase tracking-[0.12em] text-zinc-500">Current</p>
                              <p className="mt-1 font-mono text-zinc-100">{formatAssumptionCurrentValue(entry.row.label, currentAssumptionValue(entry.row.label), currencyContext)}</p>
                            </div>
                            <div>
                              <p className="uppercase tracking-[0.12em] text-zinc-500">Min</p>
                              <p className="mt-1 font-mono text-zinc-100">{formatAssumptionValue(entry.row.label, entry.row.min, currencyContext)}</p>
                            </div>
                            <div>
                              <p className="uppercase tracking-[0.12em] text-zinc-500">Max</p>
                              <p className="mt-1 font-mono text-zinc-100">{formatAssumptionValue(entry.row.label, entry.row.max, currencyContext)}</p>
                            </div>
                          </div>
                        </article>
                      ) : null,
                    )}
                  </div>
                ) : null}
                <div className={`${showAssumptionsRangeMobile ? "hidden sm:block" : "block"} overflow-auto`}>
                  <table className="hib-values-table w-full text-sm sm:min-w-[620px]">
                    <thead className="border-b border-white/10 text-zinc-500">
                      <tr>
                        <th className="py-1 text-left font-normal">Metric</th>
                        <th className="py-1 text-right font-normal">Mean</th>
                        <th className="py-1 text-right font-normal">Current</th>
                        <th className="hidden py-1 text-right font-normal sm:table-cell">Min</th>
                        <th className="hidden py-1 text-right font-normal sm:table-cell">Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assumptionsDisplayRows.map((entry) =>
                        entry?.type === "spacer" ? (
                          <tr key={entry.key}>
                            <td colSpan={5} className="h-3" />
                          </tr>
                        ) : entry?.type === "metric" ? (
                          <tr key={entry.key} className="border-b border-white/5">
                            <td className="py-1 pr-2">{entry.row.label}</td>
                            <td className="py-1 text-right font-mono">{formatAssumptionValue(entry.row.label, entry.row.mean, currencyContext)}</td>
                            <td className="py-1 text-right font-mono">{formatAssumptionCurrentValue(entry.row.label, currentAssumptionValue(entry.row.label), currencyContext)}</td>
                            <td className="hidden py-1 text-right font-mono sm:table-cell">{formatAssumptionValue(entry.row.label, entry.row.min, currencyContext)}</td>
                            <td className="hidden py-1 text-right font-mono sm:table-cell">{formatAssumptionValue(entry.row.label, entry.row.max, currencyContext)}</td>
                          </tr>
                        ) : null,
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {!hideScoreFooter ? (
              <section className="grid gap-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4 lg:grid-cols-[1fr_auto]">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-100">Score</p>
                  <p className={`text-4xl font-bold ${scoreToneClass}`}>
                    {typeof finalAdjustedScore === "number" && Number.isFinite(finalAdjustedScore) ? finalAdjustedScore.toFixed(2) : "N/A"}
                  </p>
                  <p className="mt-2 text-xl font-semibold text-zinc-100">
                    <span>Mean Target Price: </span>
                    <span className={consensusMeanClass}>{fmtTargetOrFloor(consensus?.mean_target_price, currencyContext)}</span>{" "}
                    <span className={consensusChangeClass}>
                      {typeof consensusChangePct === "number" ? `(${fmtPct(consensusChangePct)})` : "(N/A)"}
                    </span>
                  </p>
                  <p className="text-lg font-semibold text-zinc-100">
                    <span>Mean Investment Score Input: </span>
                    <span className={toneClassFromSign(scoreCard.position_size_pct_of_notional)}>
                      {fmtScoreInputPctOnly(scoreCard.position_size_pct_of_notional)}
                    </span>
                  </p>
                  <p className="hib-neutral-metric text-sm">
                    Overall Disagreement Score: {typeof overallDisagreement === "number" ? fmtNum(overallDisagreement) : "N/A"}
                  </p>
                </div>
                <div className="grid gap-2">
                  <a className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm" href={data.downloads?.analysis_pdf}><Download size={14} />Analysis PDF</a>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

