import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { isDbEnabled } from "@/lib/db";
import { getDeletedReportFilterForTicker, siteRunIdFromPathLike } from "@/lib/deleted-reports";
import { fetchLatestReport, fetchReportById } from "@/lib/reports-db";
import { findLatestByFileName, outputsRoot, resolveDashboardReportPath } from "@/lib/server-outputs";

const KIND_TO_FILE: Record<
  string,
  { fileName: string; contentType: string; downloadName?: string; r2Kind?: string; fallbackFileName?: string; fallbackR2Kind?: string }
> = {
  "analysis-pdf": { fileName: "{TICKER}_analysis.pdf", contentType: "application/pdf" },
  "analysis-txt": { fileName: "{TICKER}_analysis.txt", contentType: "text/plain; charset=utf-8" },
  "prices-explain-txt": { fileName: "{TICKER}_prices_explain.txt", contentType: "text/plain; charset=utf-8" },
  "prices-explain-pdf": { fileName: "{TICKER}_prices_explain.pdf", contentType: "application/pdf" },
  "valuation-pdf": {
    fileName: "{TICKER}_prices_explain.pdf",
    downloadName: "{TICKER}_valuation.pdf",
    r2Kind: "prices-explain-pdf",
    contentType: "application/pdf",
  },
  "combined-pdf": {
    fileName: "{TICKER}_combined.pdf",
    fallbackFileName: "{TICKER}_analysis.pdf",
    fallbackR2Kind: "analysis-pdf",
    contentType: "application/pdf",
  },
  "dashboard-json": { fileName: "{TICKER}_dashboard.json", contentType: "application/json; charset=utf-8" },
  "prices-chart": { fileName: "{TICKER}_prices_valuation.png", contentType: "image/png" },
  "trading-agents-json": { fileName: "{TICKER}_trading_agents.json", contentType: "application/json; charset=utf-8" },
  "trading-agents-txt": { fileName: "{TICKER}_trading_agents.txt", contentType: "text/plain; charset=utf-8" },
  "market-review-json": { fileName: "{TICKER}_market_review.json", contentType: "application/json; charset=utf-8" },
};

function findInTree(rootDir: string, fileName: string): string | null {
  const target = fileName.toUpperCase();
  const stack: string[] = [rootDir];

  while (stack.length) {
    const dir = String(stack.pop() || "");
    if (!dir) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.toUpperCase() === target) {
        return full;
      }
    }
  }

  return null;
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function r2PublicUrl(r2Key: string): string | null {
  const key = String(r2Key || "").trim();
  if (!key) return null;
  if (key.startsWith("http://") || key.startsWith("https://")) return key;
  const base = String(process.env.R2_PUBLIC_BASE_URL || "").trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function downloadDateStamp(value: unknown): string {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "report_date";
  return `${date.getDate()}_${date.getMonth() + 1}_${String(date.getFullYear()).slice(-2)}`;
}

function artifactDownloadBase(kind: string): string {
  if (kind === "analysis-pdf" || kind === "analysis-txt") return "analysis";
  if (kind === "valuation-pdf" || kind === "prices-explain-pdf" || kind === "prices-explain-txt") return "valuation";
  if (kind === "combined-pdf") return "combined";
  if (kind === "dashboard-json") return "dashboard";
  if (kind === "market-review-json") return "market_review";
  if (kind === "trading-agents-json" || kind === "trading-agents-txt") return "trading_agents";
  return kind.replace(/-/g, "_");
}

function extensionForSpec(spec: { fileName: string; downloadName?: string }, ticker: string): string {
  const candidate = (spec.downloadName || spec.fileName).replace("{TICKER}", ticker);
  const ext = path.extname(candidate);
  return ext || "";
}

function datedDownloadName(ticker: string, kind: string, spec: { fileName: string; downloadName?: string }, dateValue: unknown): string {
  return `${ticker}_${artifactDownloadBase(kind)}_${downloadDateStamp(dateValue)}${extensionForSpec(spec, ticker)}`;
}

function dateFromDashboardNear(filePath: string): string | null {
  try {
    const dir = path.dirname(filePath);
    const entries = fs.readdirSync(dir);
    const dashboardFile = entries.find((entry) => entry.toUpperCase().endsWith("_DASHBOARD.JSON"));
    if (!dashboardFile) return null;
    const payload = JSON.parse(fs.readFileSync(path.join(dir, dashboardFile), "utf-8")) as Record<string, unknown>;
    return String(payload.generated_at || payload.report_mtime || "").trim() || null;
  } catch {
    return null;
  }
}

function fileDateFallback(filePath: string): string {
  const dashboardDate = dateFromDashboardNear(filePath);
  if (dashboardDate) return dashboardDate;
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return "";
  }
}

async function remoteArtifactResponse(url: string, contentType: string, downloadName: string): Promise<NextResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch artifact file." }, { status: 502 });
  }
  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("Content-Type") || contentType);
  headers.set("Content-Disposition", `attachment; filename="${downloadName}"`);
  const body = new Uint8Array(await res.arrayBuffer());
  return new NextResponse(body, { status: 200, headers });
}

function collectDbCandidateRoots(row: Awaited<ReturnType<typeof fetchReportById>>): string[] {
  if (!row) return [];
  const roots = new Set<string>();

  // For site runs we persist artifacts under outputs/_site_runs/<run_id>/...
  const runId = String(row.source_run_id || "").trim();
  if (runId) {
    roots.add(path.resolve(outputsRoot(), "_site_runs", runId));
    roots.add(path.resolve(outputsRoot(), runId));
  }

  // Dashboard JSON may contain absolute artifact paths; use their directories.
  const dash = asObject(row.dashboard);
  const artifacts = asObject(dash?.artifacts);
  const dashboardPath = typeof artifacts?.dashboard_json === "string" ? artifacts.dashboard_json : "";
  const analysisTxtPath = typeof artifacts?.analysis_txt === "string" ? artifacts.analysis_txt : "";
  const pricesExplainTxtPath =
    typeof artifacts?.prices_explain_txt === "string" ? artifacts.prices_explain_txt : "";
  const reportFilePath = typeof dash?.report_file === "string" ? dash.report_file : "";

  for (const p of [dashboardPath, analysisTxtPath, pricesExplainTxtPath, reportFilePath]) {
    const candidate = String(p || "").trim();
    if (!candidate) continue;
    roots.add(path.dirname(candidate));
  }

  return Array.from(roots);
}

function resolveFromRoot(rootDir: string, fileName: string): string {
  const root = String(rootDir || "").trim();
  if (!root) return "";
  const direct = path.resolve(root, fileName);
  if (isExistingFile(direct)) return direct;
  return findInTree(root, fileName) || "";
}

async function resolveReportScopedFile(
  ticker: string,
  kind: string,
  reportId: string,
  fileName: string,
  fallbackFileName = "",
): Promise<{ foundPath: string; r2Url: string | null; generatedAt: string }> {
  const spec = KIND_TO_FILE[kind];
  const dbEnabled = isDbEnabled();
  const deletedFilter = await getDeletedReportFilterForTicker(ticker);
  if (deletedFilter.isDeleted(reportId, ticker)) return { foundPath: "", r2Url: null, generatedAt: "" };

  if (dbEnabled) {
    if (!isUuid(reportId)) return { foundPath: "", r2Url: null, generatedAt: "" };
    try {
      const row = await fetchReportById(reportId);
      if (!row) return { foundPath: "", r2Url: null, generatedAt: "" };
      if (String(row.ticker || "").toUpperCase() !== ticker) return { foundPath: "", r2Url: null, generatedAt: "" };
      const generatedAt = String(row.generated_at || "");

      const r2Key = String(row.r2_keys?.[spec?.r2Kind || kind] || "").trim();
      const url = r2PublicUrl(r2Key);
      if (url) return { foundPath: "", r2Url: url, generatedAt };
      const fallbackR2Key = String(row.r2_keys?.[spec?.fallbackR2Kind || ""] || "").trim();
      const fallbackUrl = r2PublicUrl(fallbackR2Key);
      if (fallbackUrl) return { foundPath: "", r2Url: fallbackUrl, generatedAt };

      for (const root of collectDbCandidateRoots(row)) {
        const foundPath = resolveFromRoot(root, fileName) || (fallbackFileName ? resolveFromRoot(root, fallbackFileName) : "");
        if (foundPath) return { foundPath, r2Url: null, generatedAt };
      }
    } catch {
      // DB unreachable or invalid UUID parse; fall through to filesystem compatibility.
    }
  }

  const reportPath = resolveDashboardReportPath(reportId);
  if (reportPath) {
    if (deletedFilter.isDeleted(reportId, ticker, siteRunIdFromPathLike(reportPath))) {
      return { foundPath: "", r2Url: null, generatedAt: "" };
    }
    const foundPath = resolveFromRoot(path.dirname(reportPath), fileName);
    if (!foundPath && fallbackFileName) {
      const fallbackPath = resolveFromRoot(path.dirname(reportPath), fallbackFileName);
      return { foundPath: fallbackPath, r2Url: null, generatedAt: fileDateFallback(fallbackPath || reportPath) };
    }
    return { foundPath, r2Url: null, generatedAt: fileDateFallback(foundPath || reportPath) };
  }

  // UUID report_id path (DB-first): use exact report row, not "latest ticker".
  try {
    const row = await fetchReportById(reportId);
    if (!row) return { foundPath: "", r2Url: null, generatedAt: "" };
    if (String(row.ticker || "").toUpperCase() !== ticker) return { foundPath: "", r2Url: null, generatedAt: "" };
    const generatedAt = String(row.generated_at || "");

    const r2Key = String(row.r2_keys?.[spec?.r2Kind || kind] || "").trim();
    const url = r2PublicUrl(r2Key);
    if (url) return { foundPath: "", r2Url: url, generatedAt };
    const fallbackR2Key = String(row.r2_keys?.[spec?.fallbackR2Kind || ""] || "").trim();
    const fallbackUrl = r2PublicUrl(fallbackR2Key);
    if (fallbackUrl) return { foundPath: "", r2Url: fallbackUrl, generatedAt };

    for (const root of collectDbCandidateRoots(row)) {
      const foundPath = resolveFromRoot(root, fileName) || (fallbackFileName ? resolveFromRoot(root, fallbackFileName) : "");
      if (foundPath) return { foundPath, r2Url: null, generatedAt };
    }
  } catch {
    // DB unreachable or invalid UUID parse; fall through to "not found for report".
  }

  return { foundPath: "", r2Url: null, generatedAt: "" };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ ticker: string; kind: string }> },
) {
  const params = await context.params;
  const ticker = String(params.ticker || "").toUpperCase().trim();
  const kind = String(params.kind || "").toLowerCase().trim();
  if (!ticker || !kind || !(kind in KIND_TO_FILE)) {
    return NextResponse.json({ error: "Invalid ticker or artifact kind." }, { status: 400 });
  }

  const spec = KIND_TO_FILE[kind];
  const fileName = spec.fileName.replace("{TICKER}", ticker);
  const fallbackFileName = spec.fallbackFileName?.replace("{TICKER}", ticker) || "";
  const url = new URL(request.url);
  const reportId = String(url.searchParams.get("report_id") || "").trim();

  let foundPath = "";
  let artifactDate = "";
  if (reportId) {
    const resolved = await resolveReportScopedFile(ticker, kind, reportId, fileName, fallbackFileName);
    artifactDate = resolved.generatedAt;
    if (resolved.r2Url) {
      return remoteArtifactResponse(
        resolved.r2Url,
        spec.contentType,
        datedDownloadName(ticker, kind, spec, artifactDate),
      );
    }
    foundPath = resolved.foundPath;

    if (!foundPath) {
      return NextResponse.json(
        { error: `${fileName} was not found for report_id=${reportId}.` },
        { status: 404 },
      );
    }
  } else {
    // No explicit report scope: prefer latest DB report's R2 object when available.
    const dbEnabled = isDbEnabled();
    try {
      const row = await fetchLatestReport(ticker);
      artifactDate = String(row?.generated_at || "");
      const r2Key = String(row?.r2_keys?.[spec.r2Kind || kind] || "").trim();
      const r2Url = r2PublicUrl(r2Key);
      if (r2Url) return remoteArtifactResponse(r2Url, spec.contentType, datedDownloadName(ticker, kind, spec, artifactDate));
      const fallbackR2Key = String(row?.r2_keys?.[spec.fallbackR2Kind || ""] || "").trim();
      const fallbackR2Url = r2PublicUrl(fallbackR2Key);
      if (fallbackR2Url) {
        return remoteArtifactResponse(fallbackR2Url, spec.contentType, datedDownloadName(ticker, kind, spec, artifactDate));
      }
      if (dbEnabled && !row) {
        return NextResponse.json({ error: `${fileName} was not found.` }, { status: 404 });
      }
    } catch {
      // DB unreachable / missing row: fall through to FS path below.
    }
  }

  const deletedFilter = await getDeletedReportFilterForTicker(ticker);
  const latestPath = foundPath
    ? foundPath
    : findLatestByFileName(fileName)?.path || (fallbackFileName ? findLatestByFileName(fallbackFileName)?.path : "") || "";
  const found =
    latestPath && !deletedFilter.isDeleted("", ticker, siteRunIdFromPathLike(latestPath))
      ? { path: latestPath }
      : null;
  if (!found) {
    return NextResponse.json({ error: `${fileName} was not found.` }, { status: 404 });
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(found.path);
  } catch {
    return NextResponse.json({ error: "Failed to read artifact file." }, { status: 500 });
  }

  const headers = new Headers();
  headers.set("Content-Type", spec.contentType);
  const downloadName = datedDownloadName(ticker, kind, spec, artifactDate || fileDateFallback(found.path));
  headers.set("Content-Disposition", `attachment; filename="${downloadName}"`);
  return new NextResponse(new Uint8Array(buf), { status: 200, headers });
}
