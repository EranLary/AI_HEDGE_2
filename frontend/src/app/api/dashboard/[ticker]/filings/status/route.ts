import { NextResponse } from "next/server";

import { getStoredTickerFilingsStatus } from "@/lib/filings-stored";
import { TICKER_RE } from "@/lib/site-runner";
import { parseApiWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unavailablePayload(ticker: string, contextError = "") {
  return {
    ok: true,
    ticker,
    filings: {
      annual: { available: false, source: "", form_type: "", date: "", source_url: "", text: "" },
      quarterly: { available: false, source: "", form_type: "", date: "", source_url: "", text: "" },
    },
    context_error: contextError,
  };
}

export async function GET(
  req: Request,
  context: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await context.params;
  const tk = String(ticker || "").trim().toUpperCase();
  if (!TICKER_RE.test(tk)) {
    return NextResponse.json({ error: "Invalid ticker format." }, { status: 400 });
  }

  const workspace = parseApiWorkspace(new URL(req.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });

  try {
    const status = await getStoredTickerFilingsStatus(tk, workspace);
    return NextResponse.json({
      ok: true,
      ticker: status.ticker,
      filings: status.filings,
      context_error: status.context_error || "",
    });
  } catch (err) {
    return NextResponse.json(unavailablePayload(tk, String(err)));
  }
}
