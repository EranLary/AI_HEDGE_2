# Valuation Methods and Proposed Sector Weights

## Purpose and status

This document describes the valuation families currently produced by AI Hedge and proposes a sector-aware weighting policy for a future weighted target price.

The method mechanics below describe current code. The sector weights are a design recommendation only: the production consensus still gives one equal vote to every successful valuation family. Dream Team is one family, not ten separate families. P/B is present only for eligible Yahoo Finance sectors and only when it returns a valid result.

## Shared conventions

- `S` is the verified total-company share count selected by the existing share-count resolution flow.
- Company-level values are normalized to full USD units before valuation.
- Every method must return an `investment_amount` in `[-100000, 100000]` and an `investment_rationale`; allocation does not enter the target-price formula.
- Scenario probabilities must sum to one. Invalid output is retried once and then only that family is omitted.
- The LLM never controls the share-count denominator. Except for the direct target-market-cap families, deterministic Python code converts the LLM assumptions into market capitalization and target price.
- Each family is reduced to one target-price observation before consensus. Dream Team is reduced to the arithmetic mean of its valid persona target prices.

## Method catalog

### 1. Scenario DCF

**LLM output.** A step-by-step analysis; Bull, Base, and Bear arrays containing `[probability, fcf_next_year, explicit_growth, WACC, terminal_growth]`; a `representative_ev_current`; scenario rationales; and investment allocation.

**Target-price calculation.** For each scenario `s`, the current implementation projects five annual cash flows as:

`FCF(s,t) = fcf_next_year(s) × (1 + growth(s))^t`, for `t = 1..5`.

It discounts those cash flows at the scenario WACC and adds a discounted Gordon-growth terminal value:

`Terminal Value(s) = FCF(s,5) × (1 + terminal_growth(s)) / (WACC(s) - terminal_growth(s))`.

The resulting enterprise value is bridged to common-equity value using:

`EV-to-equity adjustment = representative_ev_current - current_market_cap`.

`Scenario Price(s) = (DCF Enterprise Value(s) - EV-to-equity adjustment) / S`.

`DCF Target Price = Σ probability(s) × Scenario Price(s)`.

**Valuation logic.** This is the most intrinsic cash-flow-based family. It is strongest when free cash flow, reinvestment, capital intensity, and the cost of capital can be estimated meaningfully. It is weaker for financial institutions, where debt is an operating input and conventional enterprise free cash flow is difficult to define.

### 2. Target Scenario

**LLM output.** A step-by-step analysis; Bull, Base, and Bear arrays containing `[probability, target_market_cap]`; scenario rationales; and investment allocation.

**Target-price calculation.** The LLM supplies total common-equity values, not per-share prices:

`Target Price = Σ probability(s) × target_market_cap(s) / S`.

**Valuation logic.** This is the most flexible scenario family. The analyst can triangulate normalized earnings, revenue, assets, capital structure, and relevant multiples differently in each scenario. Its flexibility makes it broadly applicable, but less mechanically constrained than the other methods.

### 3. Earnings Scenario

**LLM output.** A step-by-step analysis; Bull, Base, and Bear arrays containing `[probability, normalized_net_income_in_year_3]`; one shared long-term `pe_multiple`; scenario and multiple rationales; and investment allocation.

**Target-price calculation.** The backend first computes probability-weighted normalized earnings:

`Expected Net Income in Year 3 = Σ probability(s) × net_income_3y(s)`.

`Target Market Cap = Expected Net Income in Year 3 × P/E Multiple`.

`Target Price = Target Market Cap / S`.

**Valuation logic.** This family is useful when net income is a meaningful and reasonably normalizable measure of shareholder economics. It emphasizes sustainable margins, tax, cyclicality, dilution, earnings quality, reinvestment needs, and the durability of the selected P/E multiple.

### 4. Revenue Scenario

**LLM output.** A step-by-step analysis; Bull, Base, and Bear arrays containing `[probability, normalized_revenue_in_year_3]`; one shared `ev_sales_multiple`; a `representative_ev_current`; rationales; and investment allocation.

**Target-price calculation.** The backend calculates:

`Expected Revenue in Year 3 = Σ probability(s) × revenue_3y(s)`.

`Target Enterprise Value = Expected Revenue in Year 3 × EV/Sales Multiple`.

`Target Market Cap = Target Enterprise Value - (representative_ev_current - current_market_cap)`.

`Target Price = Target Market Cap / S`.

**Valuation logic.** Revenue is often more stable than earnings and remains usable for high-growth or temporarily unprofitable operating companies. The EV/Sales multiple must still reflect expected margins, growth, capital intensity, leverage, and risk. It is deliberately given little or no weight where revenue is not comparable across firms or does not describe the economics well.

### 5. Composite Scenario

**LLM output.** A current-year representative revenue anchor and Bull, Base, and Bear arrays containing `[probability, three_year_average_revenue_growth, operating_margin, net_financing_result, tax_rate, pe_multiple]`, plus analysis, rationales, and investment allocation.

**Target-price calculation.** For each scenario:

`Revenue Year 3(s) = representative_revenue_current_year × (1 + growth(s))^3`.

`Operating Earnings(s) = Revenue Year 3(s) × operating_margin(s)`.

`Net Income(s) = (Operating Earnings(s) + net_financing_result(s)) × (1 - tax_rate(s))`.

`Scenario Price(s) = Net Income(s) × pe_multiple(s) / S`.

`Composite Target Price = Σ probability(s) × Scenario Price(s)`.

**Valuation logic.** This explicitly connects revenue growth to margins, financing, tax, earnings, and valuation. It is especially useful for operating businesses whose future economics depend on both growth and margin normalization, rather than on a single top-line or bottom-line assumption.

### 6. SOTP Scenario

**LLM output.** Bull, Base, and Bear objects with a probability and the same flat map of business activities. Every activity is a full-USD enterprise-value component, and every scenario must also contain an activity named exactly `Equity Adjustments`. The output also includes analysis, scenario rationales, and investment allocation.

**Target-price calculation.** For each scenario:

`Scenario Equity Value(s) = Σ activity_value(s)`, including `Equity Adjustments`.

`Scenario Price(s) = max(0, Scenario Equity Value(s) / S)`.

`SOTP Target Price = Σ probability(s) × Scenario Price(s)`.

**Valuation logic.** SOTP prevents unlike businesses from being forced into one multiple or cash-flow model. It is most relevant for conglomerates, multi-segment platforms, diversified industrials, energy portfolios, property portfolios, and businesses containing material non-operating assets or liabilities.

### 7. P/B Valuation

**Eligibility.** This family is called only when the normalized Yahoo Finance sector is `Financial Services`, `Real Estate`, `Utilities`, `Industrials`, or `Basic Materials`.

**LLM output.** One `representative_book_equity` attributable to common shareholders, one positive `pb_multiple`, a numeric bridge and separate rationale for each, a step-by-step analysis, and investment allocation. The LLM is forbidden from returning target market capitalization, target price, or shares outstanding.

**Target-price calculation.** The backend calculates:

`Target Market Cap = Representative Book Equity × P/B Multiple`.

`Target Price = Target Market Cap / S`.

**Valuation logic.** P/B connects the equity capital base to the sustainable return earned on that equity. The multiple should reflect through-cycle ROE, growth, cost of equity, asset quality, leverage, regulation, cyclicality, and balance-sheet risk. It is strongest where book equity is economically meaningful. For property-owning real estate, historical-cost book value is an imperfect proxy for current NAV, so P/B should complement rather than displace SOTP/NAV-style analysis.

### 8. Dream Team

**LLM output.** Each of ten investor personas independently returns a `target_market_cap`, target-market-cap rationale, step-by-step analysis, and investment allocation using that persona's investment philosophy.

**Target-price calculation.** For each valid persona:

`Persona Target Price(i) = target_market_cap(i) / S`.

The family is then collapsed to one vote:

`Dream Team Target Price = arithmetic mean of valid Persona Target Prices`.

**Valuation logic.** Dream Team is a qualitative model-risk diversifier. It exposes the same evidence to different capital-allocation philosophies and reduces dependence on one mechanical framework. It should retain a meaningful but bounded weight because the personas can use heterogeneous valuation logic and must not count as ten independent consensus families.

## Current consensus and proposed weighted target

Current production behavior calculates the arithmetic mean and median across available family targets, with each family receiving one equal vote. The displayed decision target is the average of that mean and median when both are available.

The proposed sector-aware target should instead be calculated directly from family-level targets:

`Sector Weighted Target = Σ effective_weight(m, sector) × valid_target_price(m)`.

Operational rules:

1. Select the row using the normalized Yahoo Finance sector name.
2. Apply weights only to valid, positive family target prices.
3. If a positively weighted method is unavailable or fails validation, renormalize the remaining positive weights to 100%; do not substitute a synthetic target.
4. P/B must remain unavailable outside its five eligible sectors, regardless of the table.
5. Dream Team enters once, using its persona mean.
6. Calculate weights at the family-target level, not on the existing blended `decision_target_price`.
7. Keep the unweighted mean, median, dispersion, and individual family targets visible as diagnostics.

## Recommended sector weight matrix

All rows total 100%. These are starting policy weights based on the economic fit of the current model definitions, not backtested optimal weights.

| Yahoo Finance sector | Scenario DCF | Target Scenario | Earnings Scenario | Revenue Scenario | Composite Scenario | SOTP Scenario | P/B Valuation | Dream Team |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Technology | 20% | 10% | 15% | 20% | 20% | 5% | 0% | 10% |
| Financial Services | 5% | 10% | 25% | 0% | 5% | 10% | 35% | 10% |
| Industrials | 20% | 10% | 20% | 10% | 15% | 10% | 5% | 10% |
| Healthcare | 20% | 10% | 10% | 20% | 15% | 15% | 0% | 10% |
| Communication Services | 20% | 10% | 15% | 15% | 15% | 15% | 0% | 10% |
| Consumer Cyclical | 15% | 10% | 20% | 10% | 25% | 10% | 0% | 10% |
| Energy | 25% | 10% | 15% | 5% | 15% | 20% | 0% | 10% |
| Consumer Defensive | 25% | 10% | 20% | 10% | 20% | 5% | 0% | 10% |
| Basic Materials | 20% | 10% | 15% | 5% | 15% | 15% | 10% | 10% |
| Real Estate | 10% | 10% | 5% | 5% | 5% | 35% | 20% | 10% |
| Utilities | 30% | 10% | 20% | 5% | 10% | 5% | 10% | 10% |

## Sector rationale

- **Technology:** emphasize revenue, composite economics, and DCF because growth, margin scaling, and reinvestment dominate; retain earnings for mature profitable firms.
- **Financial Services:** emphasize P/B and earnings because regulated equity capital, sustainable ROE, credit quality, and normalized earnings drive value; conventional EV/FCF and EV/Sales are weak anchors.
- **Industrials:** use a balanced cash-flow, earnings, and composite mix; retain SOTP for diversified groups and a small P/B check for capital-heavy operators.
- **Healthcare:** emphasize DCF and revenue for long-duration pipelines or temporarily unprofitable companies, while SOTP handles product/platform portfolios; earnings receives less weight because lifecycle stage varies widely.
- **Communication Services:** balance cash flow, earnings, revenue, composite, and SOTP because the sector mixes mature networks, advertising platforms, media libraries, and multi-business companies.
- **Consumer Cyclical:** emphasize composite and earnings because demand cycles, operating leverage, margins, and financing materially change normalized profitability.
- **Energy:** emphasize DCF and SOTP because commodity scenarios, reserves, project economics, and portfolio composition dominate; revenue multiples receive little weight because price cycles distort sales.
- **Consumer Defensive:** emphasize DCF, earnings, and composite models because mature demand, cash conversion, pricing, margins, and stable reinvestment are normally the main value drivers.
- **Basic Materials:** emphasize DCF and SOTP for commodity cycles and asset portfolios, with earnings/composite normalization and a modest P/B asset-base cross-check.
- **Real Estate:** emphasize SOTP as the closest current proxy to property-level NAV. P/B is secondary because historical-cost book equity can diverge substantially from current property value; conventional P/E is also de-emphasized because FFO/AFFO is generally more informative than GAAP net income for REITs.
- **Utilities:** emphasize DCF and earnings because regulated cash flows, allowed returns, financing, and long-lived capital programs dominate; P/B serves as a secondary capital-base and ROE cross-check.

## Important limitations and future calibration

- Yahoo sector is a coarse default. Industry, profitability stage, leverage, business mix, and data quality can justify an explicit override in a future router.
- The current model set does not contain dedicated REIT NAV, FFO/AFFO, reserve-based energy, or biotech pipeline/rNPV models. The matrix assigns weights to the closest available families and should be revisited if those models are added.
- The proposed numbers are judgment-based priors. Before production use, they should be evaluated out of sample by sector using report-date targets, immutable historical reports, fixed horizons, and no look-ahead. Optimization should be regularized and constrained so small samples cannot create unstable or extreme weights.
- Historical reports must retain their original consensus. A sector-weighted policy should start only with reports generated after an explicit methodology version and launch timestamp are deployed.

## Methodology references

- [CFA Institute: Market-Based Valuation — Price and Enterprise Value Multiples](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/market-based-valuation-price-enterprise-value-multiples)
- [Aswath Damodaran: Characteristics of Financial Service Firms](https://pages.stern.nyu.edu/adamodar/New_Home_Page/littlebook/financialsvccompanies.htm)
- [Aswath Damodaran: Financial Service Companies — Value Drivers](https://pages.stern.nyu.edu/adamodar/New_Home_Page/littlebook/bankvaluedriver.htm)
- [Aswath Damodaran: Price and Value to Book Ratio by Sector](https://pages.stern.nyu.edu/adamodar/New_Home_Page/datafile/pbvdata.html)
- [Aswath Damodaran: Revenue Multiples by Sector](https://pages.stern.nyu.edu/adamodar/New_Home_Page/datafile/psdata.html)
- [Aswath Damodaran: Sum-of-the-Parts Valuation](https://pages.stern.nyu.edu/adamodar/pdfiles/eqnotes/packetpg2spr13.pdf)
- [Nareit: Net Asset Value](https://www.reit.com/glossary/net-asset-value)
- [Nareit: Funds From Operations](https://www.reit.com/glossary/funds-operation-ffo)

## Code references

- Method prompts, parsers, deterministic formulas, family aggregation, and P/B eligibility: `src/ai_hedge/legacy_port.py`
- Dashboard method metrics and consensus fields: `src/ai_hedge/dashboard.py`
- Saved valuation Markdown: `src/ai_hedge/runner.py`
- Frontend normalization and Discovery/Track Record aggregation: `frontend/src/lib/`
