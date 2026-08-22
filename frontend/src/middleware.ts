import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { shouldBypassAuthForHostname } from "@/lib/auth-bypass";

const LEGACY_APP_PREFIXES = ["/reports", "/compare", "/screeners", "/discovery", "/hit-rate", "/dashboard", "/trading"];

function workspaceRouting(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const routedWorkspace = req.headers.get("x-ai-hedge-workspace");
  // A canonical workspace URL is internally rewritten to the shared app route.
  // Next may pass that rewritten request through middleware again; preserve it
  // instead of treating the inner route as a legacy URL and redirecting back to
  // Analysis (which otherwise creates a rewrite/redirect loop).
  if (
    (routedWorkspace === "analysis" || routedWorkspace === "nasdaq100")
    && LEGACY_APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return NextResponse.next({ request: { headers: req.headers } });
  }
  const match = pathname.match(/^\/(analysis|nasdaq100)(\/.*)?$/);
  if (match) {
    const workspace = match[1];
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-ai-hedge-workspace", workspace);
    const innerPath = match[2] && match[2] !== "/" ? match[2] : "/reports";
    if (workspace === "nasdaq100" && (innerPath === "/compare" || innerPath.startsWith("/compare/"))) {
      const notFoundUrl = req.nextUrl.clone();
      notFoundUrl.pathname = "/workspace-not-found";
      notFoundUrl.searchParams.set("workspace", workspace);
      return NextResponse.rewrite(notFoundUrl, { request: { headers: requestHeaders } });
    }
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = innerPath;
    rewriteUrl.searchParams.set("workspace", workspace);
    return NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/analysis/reports", req.url));
  }
  if (LEGACY_APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.redirect(new URL(`/analysis${pathname}${req.nextUrl.search}`, req.url));
  }
  return NextResponse.next();
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (shouldBypassAuthForHostname(req.nextUrl.hostname)) {
    return workspaceRouting(req);
  }

  const isPublic =
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/trading/executor/") ||
    pathname === "/api/trading/monitor";

  if (isPublic) return NextResponse.next();
  if (req.auth) return workspaceRouting(req);

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL("/auth/signin", req.url);
  url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
