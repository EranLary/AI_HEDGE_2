import { handleScreenerRequest } from "@/lib/screener-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleScreenerRequest(req, "sp500");
}
