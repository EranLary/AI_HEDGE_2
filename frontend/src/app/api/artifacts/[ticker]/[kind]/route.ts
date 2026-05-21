import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { fetchLatestReport, fetchReportById } from "@/lib/reports-db";
import { findLatestByFileName, outputsRoot, resolveDashboardReportPath } from "@/lib/server-outputs";

const KIND_TO_FILE: Record<string, { fileName: string; contentType: string }> = {
  "analysis-pdf": { fileName: "{TICKER}_analysis.pdf", contentType: "application/pdf" },
  "analysis-txt": { fileName: "{TICKER}_analysis.txt", contentType: "text/plain; charset=utf-8" },
  "prices-explain-txt": { fileName: "{TICKER}_prices_explain.txt", contentType: "text/plain; charset=utf-8" },
  "prices-explain-pdf": { fileName: "{TICKER}_prices_explain.pdf", contentType: "application/pdf" },
  "dashboard-json": { fileName: "{TICKER}_dashboard.json", contentType: "application/json; charset=utf-8" },
  "prices-chart": { fileName: "{TICKER}_prices_valuation.png", contentType: "image/png" },
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
): Promise<{ foundPath: string; r2Url: string | null }> {
  const reportPath = resolveDashboardReportPath(reportId);
  if (reportPath) {
    const foundPath = resolveFromRoot(path.dirname(reportPath), fileName);
    return { foundPath, r2Url: null };
  }

  // UUID report_id path (DB-first): use exact report row, not "latest ticker".
  try {
    const row = await fetchReportById(reportId);
    if (!row) return { foundPath: "", r2Url: null };
    if (String(row.ticker || "").toUpperCase() !== ticker) return { foundPath: "", r2Url: null };

    const r2Key = String(row.r2_keys?.[kind] || "").trim();
    const url = r2PublicUrl(r2Key);
    if (url) return { foundPath: "", r2Url: url };

    for (const root of collectDbCandidateRoots(row)) {
      const foundPath = resolveFromRoot(root, fileName);
      if (foundPath) return { foundPath, r2Url: null };
    }
  } catch {
    // DB unreachable or invalid UUID parse; fall through to "not found for report".
  }

  return { foundPath: "", r2Url: null };
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
  const url = new URL(request.url);
  const reportId = String(url.searchParams.get("report_id") || "").trim();

  let foundPath = "";
  if (reportId) {
    const resolved = await resolveReportScopedFile(ticker, kind, reportId, fileName);
    if (resolved.r2Url) {
      return NextResponse.redirect(resolved.r2Url, 302);
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
    try {
      const row = await fetchLatestReport(ticker);
      const r2Key = String(row?.r2_keys?.[kind] || "").trim();
      const r2Url = r2PublicUrl(r2Key);
      if (r2Url) return NextResponse.redirect(r2Url, 302);
    } catch {
      // DB unreachable / missing row: fall through to FS path below.
    }
  }

  const found = foundPath ? { path: foundPath } : findLatestByFileName(fileName);
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
  headers.set("Content-Disposition", `attachment; filename="${path.basename(found.path)}"`);
  return new NextResponse(new Uint8Array(buf), { status: 200, headers });
}
