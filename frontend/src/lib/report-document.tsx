import fs from "node:fs";
import path from "node:path";
import { marked, Renderer } from "marked";

export type ReportDocumentKind = "analysis" | "valuation" | "combined";

export type ReportDocumentSource = {
  ticker: string;
  companyName?: string | null;
  generatedAt?: string | null;
  analysisMd: string;
  pricesExplainMd?: string | null;
  dashboard?: unknown;
};

export type BuiltReportDocument = {
  html: string;
  markdown: string;
  title: string;
  usedStructuredValuationFallback: boolean;
};

type ReportDocumentOptions = {
  rasterPrintLogo?: boolean;
};

type TocEntry = {
  level: number;
  text: string;
  id: string;
};

const FAMOUS_VALUATOR_PERSONAS = [
  "Warren Buffett",
  "Aswath Damodaran",
  "Charlie Munger",
  "Peter Lynch",
  "Peter Thiel",
  "Howard Marks",
  "Bill Ackman",
  "Cathie Wood",
  "Ray Dalio",
  "Stanley Druckenmiller",
] as const;

const AI_PERSONA_LEGEND =
  "> **AI PERSONA legend:** Famous investor names identify synthetic AI valuation personas inspired by publicly known investment frameworks. The outputs are not statements from, or endorsements by, those individuals.";

let cachedReportCss = "";
let cachedReportLogos: {
  dark: string;
  light: string;
  printPng: string;
  printSvg: string;
} | null = null;

function reportCss(): string {
  if (cachedReportCss) return cachedReportCss;
  const cssPath = path.join(process.cwd(), "src", "lib", "report-document.css");
  cachedReportCss = fs.readFileSync(cssPath, "utf8");
  return cachedReportCss;
}

function reportLogos(): {
  dark: string;
  light: string;
  printPng: string;
  printSvg: string;
} {
  if (cachedReportLogos) return cachedReportLogos;
  const publicPath = path.join(process.cwd(), "public");
  const asDataUri = (fileName: string) =>
    `data:image/svg+xml;base64,${fs.readFileSync(path.join(publicPath, fileName)).toString("base64")}`;
  cachedReportLogos = {
    dark: asDataUri("hedge-logo-dark.svg"),
    light: asDataUri("hedge-logo-light.svg"),
    printPng: `data:image/png;base64,${fs
      .readFileSync(path.join(process.cwd(), "src", "app", "apple-icon.png"))
      .toString("base64")}`,
    printSvg: `data:image/svg+xml;base64,${fs
      .readFileSync(path.join(process.cwd(), "src", "app", "icon.svg"))
      .toString("base64")}`,
  };
  return cachedReportLogos;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(finiteNumber).filter((item): item is number => item !== null);
}

function formatNumber(value: number | null, maximumFractionDigits = 2): string {
  if (value === null) return "Not available";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatPrice(value: number | null, currency: string): string {
  if (value === null) return "Not available";
  const normalizedCurrency = String(currency || "").toUpperCase();
  if (/^[A-Z]{3}$/.test(normalizedCurrency)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: normalizedCurrency,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // Fall through to a plain numeric value with the stored currency label.
    }
  }
  return `${formatNumber(value)}${normalizedCurrency ? ` ${normalizedCurrency}` : ""}`;
}

function formatPercent(value: number | null, alreadyPercent = false): string {
  if (value === null) return "Not available";
  const normalized = alreadyPercent ? value : value * 100;
  return `${formatNumber(normalized, 1)}%`;
}

function markdownCell(value: string): string {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function textValue(value: unknown): string {
  return String(value || "").trim();
}

export function labelFamousValuatorPersonas(markdown: string): string {
  let changed = false;
  const labeled = String(markdown || "")
    .split(/\r?\n/)
    .map((line) => {
      const isDisplayLine = /^#{1,6}\s+/.test(line) || /^\s*[-*]\s+Persona\s*:/i.test(line) || /^\s*\|/.test(line);
      if (!isDisplayLine) return line;
      let next = line;
      for (const name of FAMOUS_VALUATOR_PERSONAS) {
        if (!next.includes(name) || next.includes(`${name} — AI PERSONA`)) continue;
        next = next.replaceAll(name, `${name} — AI PERSONA`);
      }
      if (next !== line) changed = true;
      return next;
    })
    .join("\n");

  if (!changed) return labeled;
  const lines = labeled.split("\n");
  const firstTitle = lines.findIndex((line) => /^#\s+/.test(line));
  const insertAt = firstTitle >= 0 ? firstTitle + 1 : 0;
  lines.splice(insertAt, 0, "", AI_PERSONA_LEGEND, "");
  return lines.join("\n");
}

export function buildTradingAgentsReportMarkdown(dashboard: unknown): string {
  const root = asObject(dashboard);
  const tradingAgents = asObject(root?.trading_agents);
  if (!tradingAgents || textValue(tradingAgents.status).toLowerCase() !== "success") return "";

  const header = asObject(root?.header);
  const displayCurrency = textValue(header?.display_currency || header?.currency);
  const priceUnitNote = textValue(header?.price_unit_note);
  const rating = textValue(tradingAgents.rating);
  const committeeView = textValue(tradingAgents.final_committee_view);
  const priceTarget = finiteNumber(tradingAgents.price_target);
  const timeHorizon = textValue(tradingAgents.time_horizon);
  if (!rating && !committeeView && priceTarget === null && !timeHorizon) return "";

  const targetLabel = `Tactical price target${priceUnitNote ? ` (${priceUnitNote})` : ""}`;
  const rows = [
    ["Committee stance", committeeView || rating || "Not available"],
    ["Rating", rating || "Not available"],
    [targetLabel, formatPrice(priceTarget, displayCurrency)],
    ["Time horizon", timeHorizon || "Not available"],
  ];

  return [
    "## TradingAgents — Independent Tactical View",
    "",
    "> **Separate by design:** This tactical output was stored only after the AI Hedge valuation process. It was not shown to the valuation personas and does not affect AI Hedge target prices, consensus, score, or allocation.",
    "",
    "| Tactical field | Independent output |",
    "| --- | ---: |",
    ...rows.map(([label, value]) => `| ${markdownCell(label)} | ${markdownCell(value)} |`),
    "",
    "### How to read this section",
    "",
    "TradingAgents is a separate multi-agent tactical lens. Compare it with the valuation evidence, but do not treat it as another member of the AI Hedge valuation consensus.",
  ].join("\n");
}

export function hasStructuredLegacyValuation(dashboard: unknown): boolean {
  const root = asObject(dashboard);
  const hub = asObject(root?.valuation_hub);
  const prices = asObject(hub?.prices);
  return finiteNumber(prices?.Current) !== null && numericArray(prices?.Overall).length > 0;
}

export function buildStructuredLegacyValuationMarkdown(
  dashboard: unknown,
  ticker: string,
): string {
  const root = asObject(dashboard);
  const header = asObject(root?.header);
  const hub = asObject(root?.valuation_hub);
  const prices = asObject(hub?.prices);
  const consensus = asObject(hub?.consensus);
  const decision = asObject(root?.decision_card);
  const currency = String(header?.currency || "").trim();
  const currentPrice = finiteNumber(prices?.Current ?? consensus?.current_price);
  const overall = numericArray(prices?.Overall);
  const meanTarget = finiteNumber(consensus?.mean_target_price) ?? overall[0] ?? null;
  const targetMin = overall.length ? Math.min(...overall) : null;
  const targetMax = overall.length ? Math.max(...overall) : null;
  const cv = finiteNumber(prices?.CV ?? consensus?.cv);
  const std = finiteNumber(prices?.STD ?? consensus?.std);
  const recommendation = String(decision?.rating || decision?.recommendation || "").trim();
  const allocation = finiteNumber(
    decision?.position_size_pct_of_notional ?? decision?.mean_investment_amount,
  );
  const allocationIsNotional = finiteNumber(decision?.position_size_pct_of_notional) !== null;
  const investmentPercents = asObject(prices?.["Investment Percents"]);

  const excludedKeys = new Set([
    "Current",
    "Overall",
    "CV",
    "STD",
    "LMIL",
    "Investment Percents",
    "LMIL Investment STD",
    "LMIL Mean Investment",
  ]);
  const methodRows = Object.entries(prices || {})
    .filter(([method, value]) => !excludedKeys.has(method) && numericArray(value).length > 0)
    .map(([method, value]) => {
      const targets = numericArray(value);
      const target = targets[0] ?? null;
      const range = targets.length > 1 && Math.min(...targets) !== Math.max(...targets)
        ? `${formatPrice(Math.min(...targets), currency)} – ${formatPrice(Math.max(...targets), currency)}`
        : "Single stored target";
      const upside = currentPrice && target !== null ? target / currentPrice - 1 : null;
      const methodAllocation = finiteNumber(investmentPercents?.[method]);
      return `| ${markdownCell(method)} | ${markdownCell(formatPrice(target, currency))} | ${markdownCell(formatPercent(upside))} | ${markdownCell(range)} | ${markdownCell(formatPercent(methodAllocation, true))} |`;
    });

  const snapshotRows = [
    ["Current price", formatPrice(currentPrice, currency)],
    ["Mean target price", formatPrice(meanTarget, currency)],
    ["Stored target range", targetMin !== null && targetMax !== null
      ? `${formatPrice(targetMin, currency)} – ${formatPrice(targetMax, currency)}`
      : "Not available"],
    ["Upside / downside to mean", currentPrice && meanTarget !== null
      ? formatPercent(meanTarget / currentPrice - 1)
      : "Not available"],
    ["Cross-method coefficient of variation", formatNumber(cv, 3)],
    ["Cross-method standard deviation", formatPrice(std, currency)],
    ["Stored recommendation", recommendation || "Not available"],
    ["Stored position size", allocationIsNotional
      ? formatPercent(allocation, true)
      : allocation !== null
        ? formatNumber(allocation)
        : "Not available"],
  ];

  return [
    `# ${ticker} - Historical Valuation`,
    "",
    "> This report predates the narrative valuation artifact. The section below is reconstructed only from the structured valuation values stored with the original report; no missing narrative has been invented.",
    "",
    "## Consensus snapshot",
    "",
    "| Metric | Stored value |",
    "| --- | ---: |",
    ...snapshotRows.map(([label, value]) => `| ${markdownCell(label)} | ${markdownCell(value)} |`),
    "",
    "## Method targets",
    "",
    "| Method | Target | Upside / downside | Stored range | Suggested allocation |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...(methodRows.length ? methodRows : ["| No method-level targets were stored | — | — | — | — |"]),
    "",
    "## Interpretation note",
    "",
    "The figures above reproduce the original structured result. They are historical outputs, not live prices or a newly calculated recommendation.",
  ].join("\n");
}

function valuationMarkdown(source: ReportDocumentSource): {
  markdown: string;
  usedFallback: boolean;
} {
  const native = String(source.pricesExplainMd || "").trim();
  if (native) return { markdown: labelFamousValuatorPersonas(native), usedFallback: false };
  if (hasStructuredLegacyValuation(source.dashboard)) {
    return {
      markdown: labelFamousValuatorPersonas(
        buildStructuredLegacyValuationMarkdown(source.dashboard, source.ticker),
      ),
      usedFallback: true,
    };
  }
  return {
    markdown: [
      `# ${source.ticker} - Valuation unavailable`,
      "",
      "> This historical report does not contain a narrative or structured valuation artifact. The analysis remains available, but a valuation section cannot be recreated faithfully.",
    ].join("\n"),
    usedFallback: true,
  };
}

export function buildReportMarkdown(
  source: ReportDocumentSource,
  kind: ReportDocumentKind,
): { markdown: string; usedStructuredValuationFallback: boolean } {
  const analysis = String(source.analysisMd || "").trim();
  const valuation = valuationMarkdown(source);
  const tradingAgents = buildTradingAgentsReportMarkdown(source.dashboard);
  const valuationWithTradingAgents = tradingAgents
    ? `${valuation.markdown}\n\n---\n\n${tradingAgents}`
    : valuation.markdown;
  if (kind === "analysis") {
    return { markdown: analysis, usedStructuredValuationFallback: false };
  }
  if (kind === "valuation") {
    return {
      markdown: valuationWithTradingAgents,
      usedStructuredValuationFallback: valuation.usedFallback,
    };
  }
  return {
    markdown: [
      "# Analysis",
      "",
      analysis,
      "",
      "---",
      "",
      "# Valuation",
      "",
      valuationWithTradingAgents,
    ].join("\n"),
    usedStructuredValuationFallback: valuation.usedFallback,
  };
}

function stripInlineMarkdown(value: string): string {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function slugBase(value: string): string {
  const normalized = stripInlineMarkdown(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "section";
}

function createSlugger(): (value: string) => string {
  const seen = new Map<string, number>();
  return (value: string) => {
    const base = slugBase(value);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };
}

function extractToc(markdown: string): TocEntry[] {
  const nextSlug = createSlugger();
  const entries: TocEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (!match) continue;
    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;
    entries.push({ level: match[1].length, text, id: nextSlug(text) });
  }
  return entries;
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeLinkHref(value: string): string {
  const href = String(value || "").trim();
  return /^(https?:|mailto:|#|\/)/i.test(href) ? href : "#";
}

function renderMarkdown(markdown: string, toc: TocEntry[]): string {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = function link({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const safeHref = escapeHtml(safeLinkHref(href));
    const safeTitle = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${safeHref}"${safeTitle} target="_blank" rel="noreferrer noopener">${label}</a>`;
  };
  renderer.image = ({ text }) => `<span class="report-image-label">${escapeHtml(text)}</span>`;

  let output = marked.parse(markdown, { async: false, gfm: true, renderer }) as string;
  let headingIndex = 0;
  output = output.replace(/<h([1-3])>([\s\S]*?)<\/h\1>/g, (match, level, contents) => {
    const entry = toc[headingIndex];
    headingIndex += 1;
    return entry ? `<h${level} id="${escapeHtml(entry.id)}">${contents}</h${level}>` : match;
  });
  output = output.replace(/<table>/g, '<div class="report-table-wrap"><table>');
  output = output.replace(/<\/table>/g, "</table></div>");
  return output;
}

function kindLabel(kind: ReportDocumentKind): string {
  if (kind === "analysis") return "Analysis report";
  if (kind === "valuation") return "Valuation report";
  return "Combined report";
}

function displayDate(value: string | null | undefined): string {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "Report date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

const THEME_SCRIPT = `
(() => {
  const root = document.documentElement;
  const key = "hib-report-theme";
  const button = document.getElementById("theme-toggle");
  const contents = document.getElementById("report-contents");
  const stored = localStorage.getItem(key);
  if (stored === "light" || stored === "dark") root.dataset.theme = stored;
  const mobileContents = window.matchMedia("(max-width: 820px)");
  const syncContents = (mobile) => {
    if (!contents) return;
    if (mobile.matches) contents.removeAttribute("open");
    else contents.setAttribute("open", "");
  };
  syncContents(mobileContents);
  if (typeof mobileContents.addEventListener === "function") {
    mobileContents.addEventListener("change", syncContents);
  }
  const update = () => {
    if (!button) return;
    const current = root.dataset.theme || "dark";
    button.textContent = current === "dark" ? "Light mode" : "Dark mode";
    button.setAttribute("aria-label", button.textContent);
  };
  if (button) button.addEventListener("click", () => {
    const next = (root.dataset.theme || "dark") === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem(key, next);
    update();
  });
  update();
})();`;

export function buildStandaloneReportHtml(
  source: ReportDocumentSource,
  kind: ReportDocumentKind,
  options: ReportDocumentOptions = {},
): BuiltReportDocument {
  const built = buildReportMarkdown(source, kind);
  const toc = extractToc(built.markdown);
  const title = `${source.ticker} ${kindLabel(kind)}`;
  const reportLabel = escapeHtml(kindLabel(kind));
  const logos = reportLogos();
  const notice = built.usedStructuredValuationFallback
    ? '<p class="report-notice">This historical valuation is reconstructed from the original stored structured values. No missing narrative was invented.</p>'
    : "";
  const tocHtml = toc.length
    ? `<nav class="report-toc" aria-label="Table of contents"><details class="report-toc-details" id="report-contents" open><summary><span class="report-toc-title">Contents</span><span class="report-toc-hint">Jump to a section</span></summary><ol>${toc
      .map((entry) => `<li><a class="level-${entry.level}" href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a></li>`)
      .join("")}</ol></details></nav>`
    : "";
  const logoMarkup = `<span class="report-logo-frame" aria-hidden="true"><img class="report-logo-image report-logo-image-dark" src="${logos.dark}" alt=""><img class="report-logo-image report-logo-image-light" src="${logos.light}" alt=""></span>`;
  const printLogo = options.rasterPrintLogo ? logos.printPng : logos.printSvg;
  const markup = `<div class="report-pdf-running-brand" id="report-pdf-running-brand" aria-hidden="true"><img class="report-pdf-logo" src="${printLogo}" alt=""><span class="report-pdf-brand-name">Hedge in a Box</span><span class="report-pdf-brand-context">${escapeHtml(source.ticker)} · ${reportLabel}</span></div><div class="report-toolbar"><button class="report-theme-toggle" id="theme-toggle" type="button">Light mode</button></div><main class="report-shell"><header class="report-hero"><div class="report-brand-lockup">${logoMarkup}<span class="report-brand-copy"><span class="report-brand">Hedge in a Box</span><span class="report-brand-subtitle">AI equity research</span></span></div><div class="report-kicker">${reportLabel}</div><h1 class="report-title">${escapeHtml(source.ticker)}</h1><p class="report-company">${escapeHtml(source.companyName || "Investment research report")}</p><ul class="report-meta"><li><span class="report-meta-label">Report</span><span class="report-meta-value">${reportLabel}</span></li><li><span class="report-meta-label">Published</span><span class="report-meta-value">${escapeHtml(displayDate(source.generatedAt))}</span></li><li><span class="report-meta-label">Format</span><span class="report-meta-value">Live HTML</span></li></ul>${notice}</header><div class="report-layout">${tocHtml}<article class="report-paper"><div class="report-markdown">${renderMarkdown(built.markdown, toc)}</div></article></div><footer class="report-footer">Generated on demand from the stored report source. PDF copies are not retained. Historical research is not live investment advice.</footer></main>`;

  return {
    html: `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(title)}</title><style>${reportCss()}</style></head><body>${markup}<script>${THEME_SCRIPT}</script></body></html>`,
    markdown: built.markdown,
    title,
    usedStructuredValuationFallback: built.usedStructuredValuationFallback,
  };
}
