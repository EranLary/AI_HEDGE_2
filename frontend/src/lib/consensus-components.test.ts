import assert from "node:assert/strict";
import test from "node:test";

import {
  consensusBlendLabel,
  effectiveConsensusWeights,
  formatConsensusWeight,
} from "./consensus-components";

test("uses stored effective 30/30/40 weights", () => {
  const weights = effectiveConsensusWeights(
    { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
    { mean: true, median: true, sector_weighted: true },
  );
  assert.deepEqual(weights.map(({ key, weight }) => [key, weight]), [
    ["mean", 0.3],
    ["median", 0.3],
    ["sector_weighted", 0.4],
  ]);
  assert.equal(consensusBlendLabel(weights), "30% Mean · 30% Median · 40% Sector-Weighted");
});

test("renormalizes configured weights when a component is unavailable", () => {
  const weights = effectiveConsensusWeights(undefined, {
    mean: true,
    median: false,
    sector_weighted: true,
  });
  assert.equal(formatConsensusWeight(weights[0].weight), "42.86%");
  assert.equal(formatConsensusWeight(weights[1].weight), "57.14%");
});

test("does not display a supplied weight for an unavailable component", () => {
  const weights = effectiveConsensusWeights(
    { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
    { mean: true, median: true, sector_weighted: false },
  );
  assert.deepEqual(weights.map(({ key, weight }) => [key, weight]), [
    ["mean", 0.5],
    ["median", 0.5],
  ]);
});
