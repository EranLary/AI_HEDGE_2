import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { buildFilingPdf } from "@/lib/filings-engine";
import { TICKER_RE } from "@/lib/site-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: Request,
  context: { params: Promise<{ ticker: string; kind: string }> },
) {
  const { ticker, kind } = await context.params;
  const tk = String(ticker || "").trim().toUpperCase();
  const filingKind = String(kind || "").trim().toLowerCase();

  if (!TICKER_RE.test(tk)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }
  if (filingKind !== "annual" && filingKind !== "quarterly") {
    return NextResponse.json({ error: "Invalid filing kind." }, { status: 400 });
  }

  let builtPath = "";
  let fileName = "";
  try {
    const built = await buildFilingPdf(tk, filingKind);
    builtPath = built.filePath;
    fileName = built.fileName;
  } catch (err) {
    const msg = String(err || "");
    const missing =
      msg.includes("filing_not_available") ||
      msg.includes("filing_pdf_not_found");
    return NextResponse.json(
      {
        error: missing
          ? `${filingKind} filing is not available for ${tk}.`
          : `Failed to build filing PDF: ${msg}`,
      },
      { status: missing ? 404 : 500 },
    );
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(builtPath);
  } catch {
    return NextResponse.json({ error: "Failed to read generated filing PDF." }, { status: 500 });
  } finally {
    try {
      fs.rmSync(path.dirname(builtPath), { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `attachment; filename="${fileName}"`);
  return new NextResponse(new Uint8Array(buf), { status: 200, headers });
}

