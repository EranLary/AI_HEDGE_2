import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCompactShares,
  formatFullShares,
  resolvedShareCount,
  shareCountChanged,
  shareCountDelta,
} from "./share-count-display";

test("uses the verified final count and detects a Yahoo adjustment", () => {
  const resolution = {
    selected_shares_outstanding: 42_274_119,
    original_yahoo_shares: 40_000_000,
    changed_from_yahoo: true,
  };
  assert.equal(resolvedShareCount(40_000_000, resolution), 42_274_119);
  assert.equal(shareCountChanged(resolution), true);
  assert.deepEqual(shareCountDelta(resolution), { count: 2_274_119, percent: 5.6852975 });
});

test("keeps matching or historical counts neutral", () => {
  assert.equal(
    shareCountChanged({ selected_shares_outstanding: 40_000_000, original_yahoo_shares: 40_000_000 }),
    false,
  );
  assert.equal(resolvedShareCount(117_217_504, null), 117_217_504);
  assert.equal(shareCountChanged(null), false);
});

test("formats compact and full share counts", () => {
  assert.equal(formatCompactShares(117_217_504), "117.22M");
  assert.equal(formatFullShares(117_217_504), "117,217,504");
  assert.equal(formatCompactShares(null), "N/A");
});
