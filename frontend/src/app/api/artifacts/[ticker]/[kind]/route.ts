import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { findLatestByFileName, resolveDashboardReportPath } from "@/lib/server-outputs";

const KIND_TO_FILE: Record<string, { fileName: string; contentType: string }> = {
  "analysis-pdf": { fileName: "{TICKER}_analysis.pdf", contentType: "application/pdf" },
  "analysis-txt": { fileName: "{TICKER}_analysis.txt", contentType: "text/plain; charset=utf-8" },
  "prices-explain-txt": { fileName: "{TICKER}_prices_explain.txt", contentType: "text/plain; charset=utf-8" },
  "prices-explain-pdf": { fileName: "{TICKER}_prices_explain.pdf", contentType: "application/pdf" },
  "dashboard-json": { fileName: "{TICKER}_dashboard.json", contentType: "application/json; charset=utf-8" },
  "prices-chart": { fileName: "{TICKER}_prices_valuation.png", contentType: "image/png" },
};

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
    const reportPath = resolveDashboardReportPath(reportId);
    if (reportPath) {
      const candidate = path.resolve(path.dirname(reportPath), fileName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        foundPath = candidate;
      }
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
