import assert from "node:assert/strict";
import test from "node:test";

import { tradingMutationsEnabled, tradingSessionIsEligible } from "./trading-access-policy";

test("preview environments cannot enable trading mutations", () => {
  assert.equal(tradingMutationsEnabled({ controlFlag: "1", previewFlag: "1" }), false);
  assert.equal(tradingMutationsEnabled({ controlFlag: "1", previewFlag: "0" }), true);
  assert.equal(tradingMutationsEnabled({ controlFlag: "0", previewFlag: "0" }), false);
});

test("trading controls require a durable Google user and reject guests", () => {
  const googleUser = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    email: "owner@example.com",
    isGuest: false,
    authProvider: "google",
  };
  assert.equal(tradingSessionIsEligible(googleUser), true);
  assert.equal(tradingSessionIsEligible({ ...googleUser, isGuest: true }), false);
  assert.equal(tradingSessionIsEligible({ ...googleUser, authProvider: "guest" }), false);
  assert.equal(tradingSessionIsEligible({ ...googleUser, id: "browser-local-id" }), false);
});
