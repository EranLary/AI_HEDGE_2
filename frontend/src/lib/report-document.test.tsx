import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportMarkdown,
  buildStandaloneReportHtml,
  buildStructuredLegacyValuationMarkdown,
  hasStructuredLegacyValuation,
} from "./report-document";

const historicalDashboard = {
  header: { currency: "USD" },
  decision_card: { rating: "Buy", position_size_pct_of_notional: 7.5 },
  valuation_hub: {
    prices: {
      Current: 100,
      Overall: [125, 130],
      CV: 0.12,
      STD: 8.5,
      DCF: [120, 128],
      Multiples: [132],
      "Investment Percents": { DCF: 8, Multiples: 6 },
    },
  },
};

test("historical valuation fallback uses only stored structured values", () => {
  assert.equal(hasStructuredLegacyValuation(historicalDashboard), true);
  const markdown = buildStructuredLegacyValuationMarkdown(historicalDashboard, "TEST");
  assert.match(markdown, /reconstructed only from the structured valuation values/i);
  assert.match(markdown, /\$100\.00/);
  assert.match(markdown, /\$125\.00/);
  assert.match(markdown, /DCF/);
  assert.match(markdown, /Buy/);
});

test("native valuation Markdown takes precedence over the historical fallback", () => {
  const built = buildReportMarkdown(
    {
      ticker: "TEST",
      analysisMd: "# Analysis\n\nEvidence.",
      pricesExplainMd: "# Native valuation\n\nOriginal narrative.",
      dashboard: historicalDashboard,
    },
    "valuation",
  );
  assert.equal(built.usedStructuredValuationFallback, false);
  assert.match(built.markdown, /Original narrative/);
  assert.doesNotMatch(built.markdown, /Historical Valuation/);
});

test("standalone report includes readable navigation, metadata, and print styling", () => {
  const built = buildStandaloneReportHtml(
    {
      ticker: "TEST",
      companyName: "Test Company",
      generatedAt: "2026-08-31T12:00:00Z",
      analysisMd: "# Thesis\n\n## Evidence\n\n| Metric | Value |\n| --- | ---: |\n| Growth | 12% |",
      pricesExplainMd: "# Valuation\n\n## DCF\n\nStored valuation narrative.",
    },
    "combined",
  );

  assert.match(built.html, /^<!doctype html>/);
  assert.match(built.html, /Test Company/);
  assert.match(built.html, /aria-label="Table of contents"/);
  assert.match(built.html, /href="#evidence"/);
  assert.match(built.html, /class="report-table-wrap"/);
  assert.match(built.html, /@media print/);
  assert.match(built.html, /PDF copies are not retained/);
});

test("stored Markdown cannot inject scripts or unsafe link schemes", () => {
  const built = buildStandaloneReportHtml(
    {
      ticker: "SAFE",
      analysisMd: "# Analysis\n\n<script>alert('unsafe')</script>\n\n[unsafe](javascript:alert(1))",
      pricesExplainMd: "# Valuation",
    },
    "analysis",
  );

  assert.doesNotMatch(built.html, /<script>alert\('unsafe'\)<\/script>/);
  assert.match(built.html, /&lt;script&gt;alert\(&#039;unsafe&#039;\)&lt;\/script&gt;/);
  assert.match(built.html, /href="#"/);
});
