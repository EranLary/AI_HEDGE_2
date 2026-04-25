import { NextResponse } from "next/server";

import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/");

  if (isPublic) return NextResponse.next();
  if (req.auth) return NextResponse.next();

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
