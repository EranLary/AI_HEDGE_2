import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonObjectFromMixedOutput } from "./python-json";

test("parses clean JSON object output", () => {
  const parsed = parseJsonObjectFromMixedOutput('{"ok":true,"value":123}');
  assert.deepEqual(parsed, { ok: true, value: 123 });
});

test("parses JSON object when noisy logs precede output", () => {
  const mixed = "Downloaded info for AAPL\nDownloaded financial data for AAPL\n{\"ok\":true,\"ticker\":\"AAPL\"}\n";
  const parsed = parseJsonObjectFromMixedOutput(mixed);
  assert.deepEqual(parsed, { ok: true, ticker: "AAPL" });
});

test("returns null when no JSON object is present", () => {
  const parsed = parseJsonObjectFromMixedOutput("Downloaded info for AAPL\nNo payload");
  assert.equal(parsed, null);
});
