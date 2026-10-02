import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardPayload } from "./dashboard-types";
import { disagreementScoreForReport } from "./disagreement-score";

function payloadWithDisagreement({
  overallCv,
  priceCv,
  investmentCv,
}: {
  overallCv?: number;
  priceCv?: number;
  investmentCv?: number;
}): DashboardPayload {
  return {
    score_card: overallCv === undefined ? undefined : { overall_cv: overallCv },
    valuation_hub: {
      consensus: {
        cv: priceCv,
        lmil: investmentCv === undefined ? [] : [0, investmentCv],
      },
    },
  } as DashboardPayload;
}

test("uses the complete score-card disagreement before raw consensus dispersion", () => {
  const payload = payloadWithDisagreement({
    overallCv: 0.45,
    priceCv: 0.2,
    investmentCv: 0.4,
  });

  assert.equal(disagreementScoreForReport(payload), 0.45);
});

test("falls back to the mean absolute consensus dispersion for legacy reports", () => {
  const payload = payloadWithDisagreement({
    priceCv: -0.2,
    investmentCv: 0.4,
  });

  assert.ok(Math.abs(Number(disagreementScoreForReport(payload)) - 0.3) < 1e-12);
});

test("returns null when no disagreement inputs are available", () => {
  assert.equal(disagreementScoreForReport(payloadWithDisagreement({})), null);
  assert.equal(disagreementScoreForReport(null), null);
});
