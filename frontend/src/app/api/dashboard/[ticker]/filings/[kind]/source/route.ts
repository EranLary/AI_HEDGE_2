import { NextResponse } from "next/server";

import { getStoredTickerFilingsStatus } from "@/lib/filings-stored";
import { TICKER_RE } from "@/lib/site-runner";
import { parseApiWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: Request,
  context: { params: Promise<{ ticker: string; kind: string }> },
) {
  const { ticker, kind } = await context.params;
  const tk = String(ticker || "").trim().toUpperCase();
  const filingKind = String(kind || "").trim().toLowerCase();
  const workspace = parseApiWorkspace(new URL(req.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });

  if (!TICKER_RE.test(tk)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }
  if (filingKind !== "annual" && filingKind !== "quarterly") {
    return NextResponse.json({ error: "Invalid filing kind." }, { status: 400 });
  }

  try {
    const status = await getStoredTickerFilingsStatus(tk, workspace);
    const filing = filingKind === "annual" ? status.filings.annual : status.filings.quarterly;
    const url = String(filing?.source_url || "").trim();
    if (!filing?.available || !url) {
      return NextResponse.json(
        { error: `${filingKind} source filing is not available for ${tk}.` },
        { status: 404 },
      );
    }
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: `${filingKind} source filing is not available for ${tk}.` },
        { status: 404 },
      );
    }
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json(
      { error: `${filingKind} source filing is not available for ${tk}.` },
      { status: 404 },
    );
  }
}
