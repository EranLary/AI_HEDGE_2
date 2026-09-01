import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportMarkdown,
  buildStandaloneReportHtml,
  buildStructuredLegacyValuationMarkdown,
  buildTradingAgentsReportMarkdown,
  hasStructuredLegacyValuation,
  labelFamousValuatorPersonas,
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

const tacticalDashboard = {
  header: { display_currency: "ILS", price_unit_note: "agorot" },
  trading_agents: {
    status: "success",
    rating: "Overweight",
    price_target: 3200,
    time_horizon: "6 months",
    final_committee_view: "Overweight",
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

test("TradingAgents tactical fields appear only in Valuation and Combined reports", () => {
  const source = {
    ticker: "ARYT.TA",
    analysisMd: "# Analysis\n\nIndependent research evidence.",
    pricesExplainMd: "# Valuation\n\nStored valuation narrative.",
    dashboard: tacticalDashboard,
  };
  const analysis = buildReportMarkdown(source, "analysis").markdown;
  const valuation = buildReportMarkdown(source, "valuation").markdown;
  const combined = buildReportMarkdown(source, "combined").markdown;

  assert.doesNotMatch(analysis, /Independent Tactical View/);
  assert.match(valuation, /TradingAgents — Independent Tactical View/);
  assert.match(valuation, /₪3,200\.00/);
  assert.match(valuation, /Tactical price target \(agorot\)/);
  assert.match(valuation, /6 months/);
  assert.match(valuation, /was not shown to the valuation personas/);
  assert.equal((combined.match(/Independent Tactical View/g) || []).length, 1);
});

test("TradingAgents section is omitted when no tactical fields were stored", () => {
  assert.equal(buildTradingAgentsReportMarkdown({ trading_agents: { status: "success" } }), "");
  assert.equal(buildTradingAgentsReportMarkdown({ trading_agents: { status: "unavailable" } }), "");
});

test("famous valuator output labels disclose AI PERSONA without rewriting narrative prose", () => {
  const input = [
    "# Valuation",
    "",
    "### Output 1 (Peter Lynch)",
    "",
    "Peter Lynch is referenced here as part of the rationale.",
    "",
    "| Persona | Target |",
    "| --- | ---: |",
    "| Warren Buffett | $120 |",
  ].join("\n");
  const labeled = labelFamousValuatorPersonas(input);

  assert.match(labeled, /Peter Lynch — AI PERSONA/);
  assert.match(labeled, /Warren Buffett — AI PERSONA/);
  assert.match(labeled, /AI PERSONA legend/);
  assert.match(labeled, /Peter Lynch is referenced here/);
  assert.doesNotMatch(labeled, /Peter Lynch — AI PERSONA is referenced here/);
});

test("standalone report includes responsive branding, navigation, metadata, and print styling", () => {
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
  assert.match(built.html, /id="report-contents" open/);
  assert.match(built.html, /Jump to a section/);
  assert.match(built.html, /href="#evidence"/);
  assert.match(built.html, /class="report-table-wrap"/);
  assert.match(built.html, /class="report-brand-lockup"/);
  assert.match(built.html, /class="report-logo-image report-logo-image-dark"/);
  assert.match(built.html, /class="report-logo-image report-logo-image-light"/);
  assert.match(built.html, /class="report-pdf-running-brand"/);
  assert.match(built.html, /class="report-pdf-logo"/);
  assert.match(built.html, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(built.html, /data:image\/png;base64,/);
  assert.match(built.html, /:root\[data-theme="light"\] \.report-logo-image-dark/);
  assert.match(built.html, /\.report-pdf-running-brand \{[\s\S]*position: fixed;/);
  assert.match(built.html, /@media print/);
  assert.match(built.html, /@media \(max-width: 440px\)/);
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
