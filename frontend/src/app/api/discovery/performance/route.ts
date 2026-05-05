import { NextResponse } from "next/server";

import { buildDiscoveryPerformancePayload } from "@/lib/discovery-performance";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const refreshRaw = String(url.searchParams.get("refresh") || "").trim().toLowerCase();
    const refresh = !(refreshRaw === "0" || refreshRaw === "false" || refreshRaw === "no");
    const payload = await buildDiscoveryPerformancePayload({
      lensType: url.searchParams.get("lens_type"),
      lensKey: url.searchParams.get("lens_key"),
      refresh,
    });
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json(
      { error: "discovery_performance_failed", message },
      { status: 500 },
    );
  }
}
