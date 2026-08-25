import assert from "node:assert/strict";
import test from "node:test";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import { config } from "./middleware";

function matches(pathname: string): boolean {
  return unstable_doesMiddlewareMatch({
    config,
    url: `https://hedge-in-a-box.com${pathname}`,
  });
}

test("middleware runs for workspace dashboard routes with dotted tickers", () => {
  assert.equal(matches("/analysis/dashboard/BSEN.TA/summary"), true);
  assert.equal(matches("/nasdaq100/dashboard/BRK.B/summary"), true);
  assert.equal(matches("/dashboard/BSEN.TA/summary"), true);
});

test("middleware protects API routes with dotted tickers", () => {
  assert.equal(matches("/api/dashboard/BSEN.TA"), true);
  assert.equal(matches("/api/dashboard/BRK.B/summary?window=all"), true);
});

test("middleware continues to skip static files", () => {
  assert.equal(matches("/_next/static/chunks/app.js"), false);
  assert.equal(matches("/_next/image/logo.png"), false);
  assert.equal(matches("/images/logo.svg"), false);
  assert.equal(matches("/favicon.ico"), false);
});
