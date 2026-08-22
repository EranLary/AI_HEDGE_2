import { NextResponse } from "next/server";

import { listTradingPortfolios, loadTradingDashboard } from "@/lib/trading-db";
import {
  isLiveTradingEnabled,
  isTradingControlEnabled,
  requireTradingUser,
  TradingUnauthorizedError,
} from "@/lib/trading-security";
import type { TradingDashboardPayload } from "@/lib/trading-types";
import { parseApiWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPreview(): boolean {
  return ["1", "true", "yes", "on"].includes(String(process.env.AUTH_BYPASS_PREVIEW || "").toLowerCase());
}

export async function GET(request: Request) {
  const workspace = parseApiWorkspace(new URL(request.url).searchParams.get("workspace"));
  if (!workspace) return NextResponse.json({ error: "Invalid workspace." }, { status: 400 });
  try {
    if (isPreview()) {
      const payload: TradingDashboardPayload = {
        enabled: false,
        live_enabled: false,
        workspace,
        connections: [],
        strategy: null,
        portfolios: await listTradingPortfolios(workspace),
        plans: [],
        events: [],
        positions: [],
        orders: [],
        fills: [],
      };
      return NextResponse.json(payload);
    }
    const user = await requireTradingUser();
    return NextResponse.json(await loadTradingDashboard({
      userId: user.userId,
      workspace,
      enabled: isTradingControlEnabled(),
      liveEnabled: isLiveTradingEnabled(),
    }));
  } catch (error) {
    if (error instanceof TradingUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("[trading] dashboard failed", error);
    return NextResponse.json({ error: "Trading dashboard is temporarily unavailable." }, { status: 503 });
  }
}
