import { NextResponse } from "next/server";

import { buildDiscoveryPayload } from "@/lib/discovery-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = await buildDiscoveryPayload({
    lensType: url.searchParams.get("lens_type"),
    lensKey: url.searchParams.get("lens_key"),
  });
  return NextResponse.json(payload);
}
