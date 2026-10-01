# Valuation Methods and Active Sector Weights

## Purpose and status

This document describes the valuation families produced by AI Hedge and the active **Sector-Weighted Valuation** policy, version `sector-weighted-v1`. The weights are judgment-based priors informed by model mechanics, persona definitions, and a qualitative cross-sector review of eleven recent reports; they are not yet out-of-sample accuracy estimates.

The sector-weighted model is a separate derived valuation row and tab. It does not enter the original Mean, Median, standard deviation, CV, or LMIL calculations. Dream Team remains one 10% family inside this model, where its family target is a sector-weighted average of valid investor-persona targets. The existing standalone Dream Team row remains an arithmetic mean, preserving the original Mean and Median inputs. P/B is present only for eligible sectors and only when it returns a valid result.

## Shared conventions

- `S` is the verified total-company share count selected by the existing share-count resolution flow.
- Company-level values are normalized to full USD units before valuation.
- Every method must return an `investment_amount` in `[-100000, 100000]` and an `investment_rationale`; allocation does not enter the target-price formula.
- Scenario probabilities must sum to one. Invalid output is retried once and then only that family is omitted.
- The LLM never controls the share-count denominator. Except for the direct target-market-cap families, deterministic Python code converts the LLM assumptions into market capitalization and target price.
- Each family is reduced to one target-price observation before the original Mean and Median. The standalone Dream Team family remains the arithmetic mean of valid persona targets; only the derived Sector-Weighted model uses the persona matrix.

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

In current production, the family is then collapsed to one vote:

`Dream Team Target Price = arithmetic mean of valid Persona Target Prices`.

Inside `sector-weighted-v1`, the family is still collapsed to one vote, but the internal mean is sector-weighted:

`Sector Dream Team Target = Σ effective_persona_weight(i, sector) × Persona Target Price(i)`.

The persona weights are normalized across the valid, positively weighted personas. A zero-weight persona does not affect that sector's Dream Team target. If a positively weighted persona is unavailable or fails validation, the other positive persona weights are renormalized to 100%. If no positively weighted persona is valid, Dream Team is unavailable and its 10% family weight is handled by the general family-level renormalization rule.

**Valuation logic.** Dream Team is a qualitative model-risk diversifier. It exposes the same evidence to different capital-allocation philosophies and reduces dependence on one mechanical framework. Sector weighting makes the single Dream Team vote more economically relevant without allowing its ten personas to become ten independent consensus families. The entire Dream Team family should retain a meaningful but bounded 10% weight in every sector.

## Active consensus and Sector-Weighted Valuation

Production calculates the original arithmetic Mean and Median across available family targets, with each family receiving one equal vote. These diagnostic aggregates exclude Sector-Weighted Valuation.

Sector-Weighted Valuation is calculated directly from canonical family-level targets:

`Sector Weighted Target = Σ effective_weight(m, sector) × valid_target_price(m)`.

Operational rules:

1. Select the row using the normalized Yahoo Finance sector name.
2. Apply weights only to valid, positive family target prices.
3. If a positively weighted method is unavailable or fails validation, renormalize the remaining positive weights to 100%; do not substitute a synthetic target.
4. P/B must remain unavailable outside its five eligible sectors, regardless of the table.
5. Dream Team enters once at a 10% family weight, using the sector-weighted persona target defined below rather than the current arithmetic persona mean.
6. Calculate weights at the family-target level, not on the existing blended `decision_target_price`.
7. Keep the unweighted mean, median, dispersion, and individual family targets visible as diagnostics.
8. Apply persona weights only inside Dream Team. They divide its 10% family envelope and do not add extra weight to the overall target.

The decision consensus uses the same component blend for target price, allocation, and score:

- Mean: 30%.
- Median: 30%.
- Sector-Weighted Valuation: 40%.

If a component is unavailable, the remaining component weights are normalized proportionally. For example, Mean plus Sector-Weighted becomes `3/7` and `4/7`. Each component score is `40% allocation + 60% target return`; the three component scores then use the same 30/30/40 blend before the existing confidence factor is applied. Sector-Weighted Valuation never re-enters CV or LMIL.

Canonical and legacy aliases that represent the same family are averaged inside that family before its configured weight is applied. Targets must be finite and positive. Allocations must be finite and inside `[-100000, 100000]`; allocation weights are normalized independently across families that have both a valid target and valid allocation.

### Sector resolution

The company profile sector is authoritative when it matches one of the eleven policy sectors. If it is absent, `deepseek-v4-flash` receives only ticker, company name, and bounded excerpts from “What the company is doing” and “Market Definition”, at temperature zero. It must return one exact sector and receives one semantic retry. A successful classification is stored in that report only. If classification fails, the latest valid report-level LLM classification for the ticker is reused; otherwise the derived model is omitted and Mean/Median weights are normalized.

### Historical backfill

The shared backfill command is `python scripts/db/backfill_sector_weighted_valuation.py`; it is read-only by default and requires `--apply` to write. It supports workspace/report filters and batching. The backfill preserves the stored Mean, reconstructs a missing Median from original model rows without the derived model, maps legacy aliases, and stores a small snapshot of the pre-backfill consensus and score. It updates only `report_artifacts.dashboard` and the matching summary columns in `reports`. It does not rewrite valuation prose, R2 objects, generation timestamps, release/workspace identity, or portfolio history. Re-running the same policy skips already-current reports unless `--force` is supplied.

## Recent-report qualitative calibration review

The weighting policy was stress-tested against the authoritative saved dashboard artifacts for eleven recent Analysis reports. The review covered every available family target, its calculation rationale, all ten Dream Team targets, and each persona's stated reasoning. It assessed economic fit, normalization quality, assumption sensitivity, double-counting risk, and whether the method measured equity-holder economics appropriate to the business.

This is **not an accuracy backtest**. These reports were generated between September 24 and September 30, 2026, so there is no mature forward outcome against which to score target accuracy. A target's proximity to the current market price is also not evidence that it is correct. The review can identify structural method fit and fragile assumptions, but realized accuracy must later be measured using immutable report-date targets and fixed forward horizons.

| Ticker | Sector | Current price | Family-target range | Dream Team persona range | Main calibration finding |
|---|---|---:|---:|---:|---|
| BKNG | Consumer Cyclical | $162.34 | $168.40-$197.45 | $146.56-$199.63 | Cash-flow, earnings, and composite approaches each captured a different part of a mature asset-light platform; the existing balanced mix remains defensible. |
| ENLT | Utilities | $69.93 | $29.54-$74.64 | $18.92-$110.49 | Negative growth-capex FCF, asset-sale gains, tax-credit exposure, leverage, and dilution made standalone DCF and earnings anchors fragile; asset-level SOTP and book/ROE checks deserve more weight. |
| CLIS.TA | Financial Services | ILA 28,980 | ILA 13,765.99-25,964.69 | ILA 12,049.01-23,721.49 | Insurance FCF, EV, and revenue are weak primary anchors because reserves, float, investment marks, and regulatory capital dominate; P/B/residual-income logic was the cleanest primary framework. |
| ELAL.TA | Industrials | ILA 1,684 | ILA 1,031.16-1,920.35 | ILA 1,089.25-1,693.01 | Peak earnings and FCF were highly geopolitical and cyclical; SOTP/EV normalization was more robust than a large standalone earnings weight. |
| CGNT | Technology | $8.52 | $7.75-$11.74 | $5.47-$10.33 | Revenue/composite methods captured software operating leverage while DCF and earnings exposed weak common-holder economics after SBC and minorities; the existing counterbalanced mix should remain unchanged. |
| INMD | Healthcare | $14.26 | $8.72-$17.37 | $11.84-$14.99 | Net cash, a shrinking device franchise, recurring consumables, and transaction optionality were separated most cleanly by SOTP; DCF was unusually sensitive to cash, interest income, and normalized FCF assumptions. |
| GLRS.TA | Consumer Defensive | ILA 10,660 | ILA 4,995.73-10,478.29 | ILA 6,163.70-9,615.37 | JTI contract loss made the valuation a binary post-contract normalization problem. Target Scenario adapted well; Revenue failed to produce a valid target and was safely omitted. The existing defensive-sector emphasis on durable cash flow, earnings, and business quality remains appropriate. |
| MSHR.TA | Real Estate | ILA 345 | ILA 11.15-412.38 | ILA 218.81-612.66, plus one invalid zero | DCF and Earnings could not produce valid targets for a distressed leveraged property residual. SOTP best separated property assets, debt, minorities, and common equity; the existing 35% SOTP and 20% P/B policy remains the right structure. |
| NICE.TA | Technology | ILA 35,170 | ILA 29,913.88-42,114.02 | ILA 25,049.23-60,013.79 | DCF, Target, Earnings, and Revenue converged on moderate upside while Composite/SOTP exposed margin and mix risk. Sector-weighted Dream Team increased the influence of AI optionality without allowing Wood's bull case to dominate. |
| SMSH.TA | Industrials | ILA 1,490 | ILA 1,127.56-1,416.36 | ILA 855.57-1,247.71 | Net cash and backlog supported value, while lumpy defense procurement, customer concentration, and weak H1 operating earnings constrained it. The balanced industrial mix remained appropriate. |
| SBUX | Consumer Cyclical | $93.95 | $44.38-$90.52 | $43.86-$74.56 | DCF was highly sensitive to normalized FCF and terminal assumptions, while Revenue, Composite, and SOTP clustered more tightly. The existing earnings/composite-led cyclical mix already provides the needed counterbalance. |

The first six-report pass changed only four family rows. Financial Services shifts 5 percentage points from Earnings to P/B; Industrials shifts 5 points from Earnings to SOTP; Healthcare shifts 5 points from DCF to SOTP; and Utilities shifts 5 points from DCF and 10 from Earnings into 10 additional SOTP points and 5 additional P/B points. The second five-report pass produced **no further family or persona changes**: the observed differences were already handled by the existing sector weights and the valid-target renormalization rules.

In the second pass, sector-weighting changed the Dream Team target versus the simple persona mean by +2.9% for GLRS.TA, +15.2% for MSHR.TA, +8.7% for NICE.TA, +0.6% for SMSH.TA, and +0.5% for SBUX. The largest change occurred exactly where intended: distressed Real Estate, where Howard Marks, Buffett, Dalio, and other capital-structure-aware lenses deserve more influence and one invalid zero target was excluded. No complete September 2026 Analysis report was available for Communication Services, Energy, or Basic Materials, so those rows remain based on method mechanics and persona fit rather than recent-report evidence.

## Active sector weight matrix (`sector-weighted-v1`)

All rows total 100%. These are starting policy weights based on the economic fit of the current model definitions, not backtested optimal weights.

| Yahoo Finance sector | Scenario DCF | Target Scenario | Earnings Scenario | Revenue Scenario | Composite Scenario | SOTP Scenario | P/B Valuation | Dream Team envelope |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Technology | 20% | 10% | 15% | 20% | 20% | 5% | 0% | 10% |
| Financial Services | 5% | 10% | 20% | 0% | 5% | 10% | 40% | 10% |
| Industrials | 20% | 10% | 15% | 10% | 15% | 15% | 5% | 10% |
| Healthcare | 15% | 10% | 10% | 20% | 15% | 20% | 0% | 10% |
| Communication Services | 20% | 10% | 15% | 15% | 15% | 15% | 0% | 10% |
| Consumer Cyclical | 15% | 10% | 20% | 10% | 25% | 10% | 0% | 10% |
| Energy | 25% | 10% | 15% | 5% | 15% | 20% | 0% | 10% |
| Consumer Defensive | 25% | 10% | 20% | 10% | 20% | 5% | 0% | 10% |
| Basic Materials | 20% | 10% | 15% | 5% | 15% | 15% | 10% | 10% |
| Real Estate | 10% | 10% | 5% | 5% | 5% | 35% | 20% | 10% |
| Utilities | 25% | 10% | 10% | 5% | 10% | 15% | 15% | 10% |

## Active Dream Team persona weight matrix (`sector-weighted-v1`)

Every row below totals 100% **inside Dream Team**. Because Dream Team is 10% of the overall sector target, a persona's overall contribution in percentage points is:

`Overall persona weight = 10% × internal Dream Team weight`.

For example, Cathie Wood's 18% internal Technology weight contributes 1.8% to the overall Technology target, while her 0% Real Estate weight contributes nothing. The other 90% of each sector target remains allocated to the non-Dream-Team families in the general matrix above.

The persona weights follow four construction principles:

1. Use the investment philosophy, analytical process, valuation style, demonstrated case studies, risk framework, strengths, and blind spots defined in each persona's repository description, rather than relying only on the investor's public label.
2. Weight usefulness for valuing an individual company in the sector, not fame or general investing ability. This gives bottom-up company valuators a broader base weight than pure macro specialists.
3. Increase macro, credit, cycle, or tactical weights only where policy, liquidity, leverage, commodity cycles, or asset recoverability are material sector-level value drivers.
4. Use zero only when a persona's defined framework has no meaningful primary fit for the sector. A small non-zero weight can still be appropriate for a secondary but explicit connection, such as Wood's digital-finance or energy-storage lens.

| Yahoo Finance sector | Warren Buffett | Aswath Damodaran | Charlie Munger | Peter Lynch | Peter Thiel | Howard Marks | Bill Ackman | Cathie Wood | Ray Dalio | Stanley Druckenmiller |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Technology | 7% | 15% | 7% | 7% | 18% | 4% | 10% | 18% | 2% | 12% |
| Financial Services | 16% | 15% | 12% | 7% | 5% | 16% | 12% | 5% | 7% | 5% |
| Industrials | 10% | 15% | 10% | 12% | 12% | 8% | 8% | 10% | 4% | 11% |
| Healthcare | 4% | 16% | 5% | 10% | 12% | 4% | 7% | 20% | 2% | 20% |
| Communication Services | 6% | 15% | 6% | 8% | 19% | 4% | 12% | 15% | 2% | 13% |
| Consumer Cyclical | 10% | 15% | 10% | 17% | 6% | 6% | 14% | 9% | 3% | 10% |
| Energy | 12% | 15% | 7% | 8% | 3% | 16% | 7% | 3% | 12% | 17% |
| Consumer Defensive | 22% | 15% | 16% | 15% | 0% | 9% | 15% | 0% | 3% | 5% |
| Basic Materials | 7% | 15% | 7% | 10% | 2% | 18% | 5% | 0% | 13% | 23% |
| Real Estate | 8% | 15% | 8% | 8% | 0% | 20% | 20% | 0% | 9% | 12% |
| Utilities | 18% | 15% | 10% | 7% | 2% | 15% | 7% | 8% | 11% | 7% |

### Persona-weight rationale

- **Warren Buffett and Charlie Munger** receive higher weights where durable demand, pricing power, balance-sheet resilience, understandable economics, incentives, and long-lived cash flows are central. Buffett's insurance and funding expertise and Munger's bank holdings also support meaningful Financial Services weights; both receive less weight where industry structure is unstable or valuation depends mainly on distant technological optionality.
- **Aswath Damodaran** receives at least 15% in every sector because his repository profile explicitly treats every asset as valuatable and adapts narrative, DCF, relative valuation, pricing, TAM, unit economics, and risk assumptions to both mature and young companies. Across all six reviewed reports, his reasoning also adapted the primary anchor to the business rather than forcing one preferred metric.
- **Peter Lynch** is emphasized in Consumer Cyclical, Consumer Defensive, Industrials, Healthcare, and Basic Materials. His company classification, firsthand operating evidence, balance-sheet checks, and willingness to value fast growers, cyclicals, and turnarounds are broadly useful, but his anti-macro orientation reduces his weight in regime-dominated sectors.
- **Peter Thiel** is concentrated in Technology and Communication Services, with meaningful Healthcare and Industrials weights because his profile emphasizes proprietary technology, networks, founder quality, defense, aerospace, infrastructure, and power-law outcomes. Stripe provides a real but narrower Financial Services connection. He receives zero in Real Estate and Consumer Defensive, where his framework has little direct primary fit.
- **Howard Marks** is emphasized in Financial Services, Real Estate, Energy, Basic Materials, and Utilities because leverage, credit conditions, cycle position, downside tails, recoverable value, and compensation for uncertainty are material there. His weight is lower in sectors whose value is driven mainly by long-duration innovation rather than asset protection or cycle pricing.
- **Bill Ackman** receives higher weights in Consumer sectors, Real Estate, Financial Services, and Communication Services. His profile emphasizes predictable recurring cash flow, franchise quality, governance, complex real assets, structural simplification, catalysts, and a credible path to value realization.
- **Cathie Wood** is concentrated in Technology, Healthcare, and Communication Services, with meaningful Industrials and Consumer Cyclical weights because her defined platforms include AI, robotics, autonomous mobility, energy storage, precision therapies, and digital networks. Digital wallets and blockchain justify a smaller Financial Services weight. The ENLT review showed that renewable generation, storage cost curves, and data-center power demand can make her lens directly relevant to a growth utility, so Utilities increases from 3% to a still-bounded 8%. Her weight is zero in Real Estate, Consumer Defensive, and Basic Materials, where her profile supplies no strong primary valuation lens.
- **Ray Dalio** is weighted below bottom-up stock analysts in most sectors because his profile explicitly focuses on economies, policy regimes, liquidity, and portfolios rather than individual companies. His weight rises in Energy, Basic Materials, Utilities, Financial Services, and Real Estate, where inflation, rates, debt, and policy transmission materially shape value.
- **Stanley Druckenmiller** receives larger weights than Dalio in Technology and Healthcare because his profile explicitly combines macro and liquidity analysis with concentrated thematic equities in semiconductors, AI infrastructure, and healthcare innovation. He is also emphasized in Energy and Basic Materials, where regime shifts can force sharp revaluation.

## Sector rationale

- **Technology:** emphasize revenue, composite economics, and DCF because growth, margin scaling, and reinvestment dominate; retain earnings for mature profitable firms.
- **Financial Services:** make P/B/residual-income logic the primary anchor because regulated equity capital, sustainable ROE, credit quality, and book-value integrity drive value. Retain normalized earnings as a secondary check; conventional EV/FCF and EV/Sales are weak anchors.
- **Industrials:** use a balanced cash-flow, earnings, composite, and SOTP mix. The increased SOTP weight improves handling of diversified groups, airlines, capital-heavy operators, and businesses whose segments or asset base should not be forced into one earnings multiple; retain a small P/B check.
- **Healthcare:** emphasize revenue and SOTP for long-duration pipelines, product portfolios, net-cash balances, and temporarily unprofitable companies. DCF remains meaningful but receives less weight because distant cash flows and binary outcomes can make it assumption-sensitive; earnings is also limited because lifecycle stage varies widely.
- **Communication Services:** balance cash flow, earnings, revenue, composite, and SOTP because the sector mixes mature networks, advertising platforms, media libraries, and multi-business companies.
- **Consumer Cyclical:** emphasize composite and earnings because demand cycles, operating leverage, margins, and financing materially change normalized profitability.
- **Energy:** emphasize DCF and SOTP because commodity scenarios, reserves, project economics, and portfolio composition dominate; revenue multiples receive little weight because price cycles distort sales.
- **Consumer Defensive:** emphasize DCF, earnings, and composite models because mature demand, cash conversion, pricing, margins, and stable reinvestment are normally the main value drivers.
- **Basic Materials:** emphasize DCF and SOTP for commodity cycles and asset portfolios, with earnings/composite normalization and a modest P/B asset-base cross-check.
- **Real Estate:** emphasize SOTP as the closest current proxy to property-level NAV. P/B is secondary because historical-cost book equity can diverge substantially from current property value; conventional P/E is also de-emphasized because FFO/AFFO is generally more informative than GAAP net income for REITs.
- **Utilities:** retain DCF as the largest family because regulated and contracted long-duration cash flows matter, but balance it with higher SOTP and P/B weights for asset portfolios, project debt, capital-base returns, dilution, and development pipelines. Earnings receives less weight because asset sales, tax credits, financing, and construction-stage economics can make reported profit a weak standalone anchor.

## Important limitations and future calibration

- Yahoo sector is a coarse default. Industry, profitability stage, leverage, business mix, and data quality can justify an explicit override in a future router.
- The current model set does not contain dedicated REIT NAV, FFO/AFFO, reserve-based energy, or biotech pipeline/rNPV models. The matrix assigns weights to the closest available families and should be revisited if those models are added.
- The active numbers are judgment-based priors. They should be evaluated out of sample by sector using report-date targets, immutable historical reports, fixed horizons, and no look-ahead. Optimization should be regularized and constrained so small samples cannot create unstable or extreme weights.
- Historical dashboards are backfilled under explicit policy version and provenance. Their original consensus/score snapshot is retained in metadata; immutable prose and R2 artifacts remain unchanged.

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
- Dream Team persona definitions used to construct the internal sector weights: `src/ai_hedge/dream_team_descriptions/`
- Dashboard method metrics and consensus fields: `src/ai_hedge/dashboard.py`
- Sector matrices, aliases, renormalization, consensus blend, and dashboard transformer: `src/ai_hedge/sector_weighted_valuation.py`
- Missing-sector classifier and prior-report fallback: `src/ai_hedge/sector_classifier.py`
- Historical dashboard and summary-column backfill: `scripts/db/backfill_sector_weighted_valuation.py`
- Saved valuation Markdown: `src/ai_hedge/runner.py`
- Frontend normalization and Discovery/Track Record aggregation: `frontend/src/lib/`
