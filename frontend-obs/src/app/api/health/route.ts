// Cheap warming probe for the service worker. No DB, no auth — its only
// job is to return 200 once the Fly machine has finished booting and the
// Next.js server can answer requests.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
