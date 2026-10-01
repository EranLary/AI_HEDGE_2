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

test("structured valuation fallback presents the stored sector-weighted consensus", () => {
  const markdown = buildStructuredLegacyValuationMarkdown(
    {
      header: { currency: "USD" },
      valuation_hub: {
        prices: { Current: 100, Mean: [120], Median: [110] },
        consensus: {
          current_price: 100,
          mean_target_price: 120,
          median_target_price: 110,
          sector_weighted_target_price: 150,
          decision_target_price: 129,
          component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
        },
        sector_weighted_valuation: { target_price: 150, investment_amount: 30000 },
      },
      score_card: {
        position_size_pct_of_notional: 21,
        mean_investment_amount_raw: 10000,
        median_investment_amount: 20000,
        sector_weighted_investment_amount: 30000,
        component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
        allocation_component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
      },
    },
    "TEST",
  );

  assert.match(markdown, /Sector-weighted target price \| \$150\.00/);
  assert.match(markdown, /Consensus target price \| \$129\.00/);
  assert.match(markdown, /Sector-weighted allocation \| 30%/);
  assert.match(markdown, /Target consensus basis \| 30% Mean \/ 30% Median \/ 40% Sector-Weighted/);
  assert.doesNotMatch(markdown, /50% Mean \/ 50% Median/);
});

test("native valuation narrative is preserved below the canonical structured snapshot", () => {
  const valuationMarkdown = [
    "# TEST Valuation Report",
    "",
    "## Valuation Decision Snapshot",
    "",
    "| Metric | Result |",
    "|---|---:|",
    "| Current Price | $100.00 |",
    "",
    "## Valuation Method Comparison",
    "",
    "| Method / Valuator | Target Price | Upside / Downside | Position | Allocation |",
    "|---|---:|---:|---|---:|",
    "| Dream Team | $120.00 | +20.00% | Short | 15.0% of $100,000 notional ($15,000.00) |",
    "",
    "### Peter Lynch — AI Persona",
    "",
    "**Method Rationale and Key Assumptions**",
  ].join("\n");
  const built = buildReportMarkdown(
    {
      ticker: "TEST",
      analysisMd: "# Analysis\n\nEvidence.",
      pricesExplainMd: valuationMarkdown,
      dashboard: historicalDashboard,
    },
    "valuation",
  );
  assert.equal(built.usedStructuredValuationFallback, false);
  assert.match(built.markdown, /Current Structured Consensus/);
  assert.match(built.markdown, /Original Valuation Narrative/);
  assert.doesNotMatch(built.markdown, /Valuation Decision Snapshot/);
  assert.match(built.markdown, /Valuation Method Comparison/);
  assert.match(built.markdown, /Short \| 15\.0% of \$100,000 notional/);
  assert.match(built.markdown, /Peter Lynch — AI Persona/);
  assert.doesNotMatch(built.markdown, /Historical Valuation/);
});

test("native historical 50/50 snapshot is replaced at render time by effective sector weights", () => {
  const native = [
    "# TEST Valuation Report",
    "",
    "## Valuation Decision Snapshot",
    "",
    "| Consensus Basis | 50% Mean / 50% Median |",
    "",
    "## Valuation Method Comparison",
    "",
    "Original method evidence remains here.",
  ].join("\n");
  const dashboard = {
    header: { currency: "USD" },
    valuation_hub: {
      prices: { Current: 100, Mean: [120], Median: [110] },
      consensus: {
        current_price: 100,
        mean_target_price: 120,
        median_target_price: 110,
        sector_weighted_target_price: 150,
        decision_target_price: 129,
        component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
      },
      sector_weighted_valuation: { target_price: 150, investment_amount: 30000 },
    },
    score_card: {
      position_size_pct_of_notional: 21,
      mean_investment_amount_raw: 10000,
      median_investment_amount: 20000,
      sector_weighted_investment_amount: 30000,
      adjusted_score: 8.5,
      component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
      allocation_component_weights: { mean: 0.3, median: 0.3, sector_weighted: 0.4 },
    },
  };
  const built = buildReportMarkdown(
    { ticker: "TEST", analysisMd: "# Analysis", pricesExplainMd: native, dashboard },
    "valuation",
  );

  assert.match(built.markdown, /30% Mean \/ 30% Median \/ 40% Sector-Weighted/);
  assert.doesNotMatch(built.markdown, /50% Mean \/ 50% Median/);
  assert.match(built.markdown, /Original method evidence remains here/);
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

test("report Markdown has one H1 and no structural headings deeper than H3", () => {
  const source = {
    ticker: "TEST",
    analysisMd: [
      "# TEST Analysis",
      "",
      "# Legacy Top Section",
      "",
      "## Nested Evidence",
      "",
      "### Deep Detail",
      "",
      "```markdown",
      "#### Code Sample",
      "```",
    ].join("\n"),
    pricesExplainMd: [
      "# TEST Valuation Report",
      "",
      "## Valuation Decision Snapshot",
      "",
      "### Model Run 1",
      "",
      "#### Deep Assumption",
    ].join("\n"),
    dashboard: tacticalDashboard,
  };

  for (const kind of ["analysis", "valuation", "combined"] as const) {
    const markdown = buildReportMarkdown(source, kind).markdown;
    const headings = markdown
      .split(/\r?\n/)
      .filter((line) => /^#{1,6}\s+/.test(line) && !line.includes("Code Sample"));
    assert.equal(headings.filter((line) => /^#\s+/.test(line)).length, 1);
    assert.equal(headings.some((line) => /^#{4,6}\s+/.test(line)), false);
  }

  const analysis = buildReportMarkdown(source, "analysis").markdown;
  assert.match(analysis, /^## Legacy Top Section$/m);
  assert.match(analysis, /^### Nested Evidence$/m);
  assert.match(analysis, /^\*\*Deep Detail\*\*$/m);
  assert.match(analysis, /```markdown\n#### Code Sample\n```/);

  const combined = buildReportMarkdown(source, "combined").markdown;
  assert.match(combined, /^# TEST Combined Investment Report$/m);
  assert.match(combined, /^## Analysis$/m);
  assert.match(combined, /^## Valuation$/m);
  assert.match(combined, /^## Independent Tactical View$/m);
  assert.match(combined, /^### Legacy Top Section$/m);
  assert.doesNotMatch(combined, /^# TEST Analysis$/m);
  assert.doesNotMatch(combined, /^# TEST Valuation Report$/m);
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
  assert.equal((built.html.match(/<h1(?:\s|>)/g) || []).length, 1);
  assert.match(built.html, /aria-label="Table of contents"/);
  assert.match(built.html, /id="report-contents" open/);
  assert.match(built.html, /Jump to a section/);
  assert.match(built.html, /href="#evidence"/);
  assert.match(built.html, /class="report-table-wrap"/);
  assert.match(built.html, /class="report-brand-lockup"/);
  assert.match(built.html, /class="report-hero-top"/);
  assert.match(built.html, /class="report-logo-image report-logo-image-dark"/);
  assert.match(built.html, /class="report-logo-image report-logo-image-light"/);
  assert.match(built.html, /class="report-pdf-running-brand"/);
  assert.match(built.html, /class="report-pdf-logo"/);
  assert.match(built.html, /class="report-pdf-header-copy"/);
  assert.match(built.html, /Hedge in a Box &middot; TEST &middot; Combined report/);
  assert.match(built.html, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(built.html, /data:image\/png;base64,/);
  assert.match(built.html, /:root\[data-theme="light"\] \.report-logo-image-dark/);
  assert.match(built.html, /content: element\(reportpdfheader\)/);
  assert.match(
    built.html,
    /\.report-pdf-running-brand \{[\s\S]*position: running\(reportpdfheader\)/,
  );
  assert.match(built.html, /\.report-pdf-running-brand \{[\s\S]*white-space: nowrap/);
  assert.match(built.html, /\.report-logo-image \{[\s\S]*object-fit: contain/);
  assert.match(built.html, /\.report-hero-top \{[\s\S]*justify-content: space-between/);
  assert.match(
    built.html,
    /@media \(max-width: 440px\) \{[\s\S]*\.report-hero-top \{[\s\S]*display: grid/,
  );
  assert.match(built.html, /@media print/);
  assert.match(built.html, /@media \(max-width: 440px\)/);
  assert.match(built.html, /PDF copies are not retained/);

  const pdfBuilt = buildStandaloneReportHtml(
    { ticker: "TEST", analysisMd: "# Branded PDF" },
    "analysis",
    { rasterPrintLogo: true },
  );
  assert.match(pdfBuilt.html, /class="report-pdf-logo"[^>]+data:image\/png;base64,/);
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
