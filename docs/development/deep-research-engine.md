# Standalone Deep Research engine

This engine is intentionally independent of the existing analysis pipeline. It
must pass blind report-quality, valuation-compilation, and economic-audit gates
before any DB, dashboard, consensus, or product integration is considered.

## Credentials

Create project-scoped API keys with billing and spending limits. Add them only
to the repository-root `.env` file:

```dotenv
OPENAI_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
```

The key must never be passed on the command line, written to artifacts, or
committed. API billing is separate from ChatGPT billing. Quality-first defaults
are documented in `.env.example`.

The standalone DeepSeek path uses an explicit DDGS web/news engine ensemble,
with an optional self-hosted SearXNG endpoint, because DeepSeek's API does not
supply a built-in web-search tool. Trafilatura is the first HTML extractor and
DDGS extraction is the fallback. DeepSeek Flash drives
the iterative retrieval loop; V4 Pro plans the investigation, builds the strict
valuation case, and writes the report. Default safeguards are a $3 estimated
usage cap, a 45-minute deadline (60-minute hard maximum), 80 tool calls, 36
searches, 30 opened sources, up to two focused valuation-case repairs, and one
report repair. The second case repair exists for compiler-localized defects; it
does not weaken or auto-correct the valuation contract.
Provider dollar cost is estimated from returned token/cache usage and the
official peak/off-peak rate for each call; it is not a provider-billed dollar
field.

Before the model plans any searches, v2 builds `research_input_packet.json`
from Yahoo identity/descriptive fields, a frozen market price, FX (including
explicit inversion provenance), and a 10-year Treasury routing proxy. Yahoo
financial-statement values and Yahoo share count are explicitly forbidden as
final valuation evidence. The engine then calls the platform's existing filing
router: SEC for non-`.TA` tickers and MAYA for `.TA` tickers. Downloaded filings
are persisted under `primary_filings/` and injected as already-opened primary
sources. Set a real contact string in `SEC_USER_AGENT`. Set
`DEEP_RESEARCH_SEARXNG_URL` only when a private SearXNG JSON API is available;
the explicit DDGS ensemble remains the no-infrastructure fallback.

The compiler owns the final `Valuation Control Summary`. Python renders the
reference/target dates, share denominator, method values, weights, target,
upside and rate inputs directly from the validated case. The report writer may
explain those values but cannot silently replace them.

## Pipeline

The current standalone pipeline separates prose quality from valuation truth:

1. Freeze a small company identity/market snapshot without existing AI_HEDGE
   recommendations or targets.
2. Run a long-lived Responses API research job with web search, Code
   Interpreter, high reasoning, full source retention, and a versioned English
   master prompt.
3. Apply a deterministic report-depth/source/section gate.
4. Run an independent structured semantic audit and recompute method weights,
   target price, upside/downside, currency, and share basis.
5. Extract a strict `valuation_case.json` and compile the valuation in Python.
6. When extraction fails, run focused structured valuation research. The model
   researches inputs; it does not choose whether its arithmetic passes.
7. Run a separate web-enabled economic auditor over the compiled case. This
   stage challenges source relevance, scope, forecasts, peers, terminal
   economics, and method weights.
8. Use a sector compiler when a generic valuation contract is insufficient.
   The first sector implementation is the driver-based broker compiler.

A report is publication-ready under the original strict common audit only when
all of the following are true:

- deterministic report quality passes;
- semantic audit score is at least 85;
- no critical or major semantic issue remains;
- the valuation case compiles without errors;
- the economic case audit scores at least 85 with no critical or major issue.

The latest repair is never promoted merely because it is latest. Candidate
selection retains every version and ranks publication readiness and blockers
before scores.

DeepSeek v2 additionally writes `research_grade.json` with separate research
and valuation grades. Its traffic-light rule is deliberately more useful than
the old all-or-nothing gate:

- **Red**: deterministic compiler failure or another material valuation blocker;
  no target is usable.
- **Amber**: the compiled target is usable with disclosed research/review
  limitations. Shortness, a missing secondary section, or another repairable
  major observation does not erase the target by itself.
- **Green**: compiler, structural target and pre-publication review all pass
  without findings.

The independent semantic audit follows the same principle: only critical
identity, freshness, currency, share-count, valuation-method, arithmetic or
contradiction failures block the target. Major issues remain Amber advisories.
This status is an evaluation artifact, not authorization to publish into the
platform.

## Main commands

Build the frozen snapshot, prompt, and redacted request without an API call:

```powershell
python scripts/run_deep_research.py --ticker IBKR --dry-run
```

Run the full narrative research and first-pass gates:

```powershell
python scripts/run_deep_research.py --ticker IBKR
```

Run the custom DeepSeek + DDGS engine against a new frozen snapshot:

```powershell
python scripts/run_provider_research.py --provider deepseek --ticker ITRN
```

Reuse a completed evidence packet and rerun only valuation and publication:

```powershell
python scripts/refine_deepseek_research.py `
  --run-dir <COMPLETED_DEEPSEEK_RUN_DIR> `
  --max-cost-usd 2.0
```

Refinement is deliberately cheaper than repeating discovery. It creates an
immutable child under `refinements/`, retains its own marginal cost ledger, and
does not overwrite the parent research run.

Reuse a frozen snapshot for an apples-to-apples provider benchmark and enforce
an explicit cost cap:

```powershell
python scripts/run_provider_research.py `
  --provider deepseek `
  --ticker ITRN `
  --snapshot-file <SNAPSHOT_JSON> `
  --max-cost-usd 3.0
```

DeepSeek runs retain the input packet, primary-filing manifest and full filing
text, plan, every tool call, extracted source documents,
evidence/coverage/contradiction ledgers, strict valuation case, compiler result,
draft and pre-publication reviews, final report, quality gate, token-level cost
ledger, traffic-light grade, and manifest. A structural or self-review pass is not publication
approval; the common independent audit and deterministic target audit still
must pass.

Resume a background response from `state.json`:

```powershell
python scripts/run_deep_research.py --ticker IBKR --resume resp_...
```

Audit an existing report candidate:

```powershell
python scripts/audit_deep_research.py --run-dir <RUN_DIR>
```

Extract and compile a report's valuation case:

```powershell
python scripts/build_valuation_case.py --run-dir <RUN_DIR>
```

Research a focused structured valuation case from a rejected candidate:

```powershell
python scripts/research_valuation_case.py `
  --run-dir <RUN_DIR> `
  --candidate repair_3 `
  --profile auto `
  --attempt 1
```

`auto` selects the broker contract only when the narrative contains multiple
independent broker-economics signals. Use `--profile broker` or
`--profile generic` to make the decision explicit and reproducible.

Audit a compiled structured case:

```powershell
python scripts/audit_valuation_case.py `
  --run-dir <RUN_DIR> `
  --profile auto `
  --research-attempt 1
```

Compile a hand-authored or future model-generated sector case:

```powershell
python scripts/compile_valuation_case.py --input valuation_case.json
python scripts/compile_broker_valuation_case.py --input broker_case.json
```

## Artifacts

Runs are stored below `.tmp/deep-research-engine/runs/<TICKER>/<RUN_ID>/`.
The base report produces snapshot, prompt, redacted request, state, raw response,
report, source index, manifest, deterministic quality, and semantic audit files.
Repairs, structured cases, compilation results/errors, and economic audits are
versioned instead of overwriting earlier evidence.

## Broker compiler contract

The generic compiler cannot prove a financial institution's economics merely
from a smooth net-income series. The broker compiler therefore:

- uses one current-fair-value date for all methods;
- starts from the latest reported parent common equity, forecasts from that
  exact date, and carries intrinsic value to the current valuation date at cost
  of equity less actual interim dividends instead of inventing an unreported
  target-date book value;
- reconciles point-in-time basic shares plus explicit incremental dilution to
  the valuation denominator;
- builds net interest income from margin loans, segregated cash/securities,
  client credit balances excluding sweeps, securities lending, FDIC sweep
  income, and residual other NII;
- builds commissions from average daily DARTs, exact-period trading days, and
  commission per DART;
- computes pretax income, tax, public economic share, parent income, book value,
  and residual income in code;
- computes peer P/E from dated prices and same-period TTM or forward GAAP EPS
  for at least five individually sourced peers; annualized-quarter EPS is
  rejected;
- rejects mismatched EPS periods, unsupported weights, misaligned book dates,
  and non-reconciling evidence.

The broker compiler, strict structured-output schema, research stage, and
auditable auto-router are implemented and unit-tested. A failed economic audit
is an `insufficient evidence` result, not a target. The broker path still must
pass live compilation and economic-audit gates before it is eligible for
publication or platform integration.

## Blind IBKR benchmark, 2026-10-03

The engine was evaluated without exposing it to the uploaded ChatGPT Deep
Research benchmark. Only after the blind run was complete was the held-out
benchmark opened.

| Candidate | Target | Structural | Semantic/economic result | Status |
|---|---:|---:|---|---|
| Blind base report | $69.00 | 100 | Semantic 72; five major issues | Rejected |
| Uploaded ChatGPT benchmark | $68.51 | Not run through retained-source gate | Similar target; also mixes current peer observations with forward EPS/current-value timing | Benchmark only |
| Report repair 1 | $62.00 | 100 | Semantic 74; four major issues | Rejected |
| Report repair 2 | $50.19 | 80 | Semantic 42; citations regressed | Rejected |
| Fresh rebuild 3 | $51.20 | 100 | Semantic 72; three major issues | Rejected |
| Fresh rebuild 4 | $50.40 | 100 | Semantic 72; three major issues | Rejected |
| Structured case 2 | $52.51 | Compiled | Economic audit 36; two critical and multiple major issues | Rejected |
| Structured case 3 | $51.63 | Compiled | Economic audit 43; six major issues | Rejected |
| Broker case v1 | $45.18 | Compiled after unit synonym fix | Economic audit 32; two critical and eight major issues | Rejected |
| Broker case v2 | $32.35 | Compiled | Economic audit 42; seven major issues | Rejected |
| Broker case v3 | $29.38 | Compiled | Economic audit 42; seven major issues | Rejected |

The near-match between the blind base target and the held-out ChatGPT target is
encouraging, but it is not proof of correctness. No IBKR target generated in
this benchmark is approved for publication. The exercise demonstrated why the
engine must preserve both the polished report and a separately compiled,
audited valuation truth layer.

The broker iterations removed critical date-overlap and free-Up-C-accretion
errors, replaced an estimated target-date book with a reported-date
carry-forward identity, required explicit dilution components, expanded NII
drivers, and replaced annualized-quarter EPS with matched TTM/forward GAAP EPS.
IBKR nevertheless remains `insufficient evidence`: web research did not produce
a defensible point-in-time award-dilution schedule, quantitatively supported
multi-year driver forecast, or durable terminal excess-ROE basis. Repeating the
model call is not an approved substitute. Those gaps require structured market
and fundamental data or an explicit conservative missing-data policy.

## Evaluation boundary

The research engine must not receive an AI_HEDGE report, target,
recommendation, or manual ChatGPT benchmark report. Existing IBKR and ITRN
reports remain held-out evaluator inputs. Once the broker-specific automated
path passes IBKR, ITRN is the next blind company test, followed by the user's
additional held-out report.

## Blind ITRN v2 benchmark, 2026-10-06

The v2 search/evidence layer was run twice from the same frozen snapshot
(`$52.53`, 2026-10-04) without exposing the engine to the manual ChatGPT report
or the platform target. Both full runs passed the deterministic research-depth
gate with a score of 100. They cost $0.766364 and $0.743040, an average of
$0.754702 per full run. Four valuation-only refinements cost $0.148244 to
$0.417190 each. The total $2.806699 spent below is an engineering experiment
total, not an expected per-ticker production cost.

No v2 ITRN target is approved. This is an intentionally negative but useful
result:

| Candidate | Marginal cost | Result | Status |
|---|---:|---|---|
| Full run 1 | $0.766364 | 7,523-word research report; FCFE date mismatch prevented a target | Red |
| Full run 2 | $0.743040 | 9,724-word research report; valuation repairs did not produce a valid case | Red |
| Refinement 1 | $0.148244 | No valid target | Red |
| Refinement 2 | $0.417190 | $10.37 asset/book-only target for a going concern | Rejected |
| Refinement 3 | $0.355372 | $58.70 FCFE target with a material forecast-date mismatch | Rejected |
| Refinement 4 | $0.376489 | Near-zero residual-income target caused by per-share/total-share unit mixing | Rejected |

The three rejected compiled cases produced permanent controls: a going concern
must include an income or cash-flow method; forecast periods must align with
their actual cash-flow dates; residual-income inputs must be absolute company
totals rather than per-share values; and share units are normalized before
compilation. These failures are material Red blockers. Minor citation,
shortness, or coverage observations remain Amber advisories and do not erase an
otherwise valid target.

The main unresolved acquisition issue is primary evidence. SEC returned HTTP
403 from the live test environment, so the filing manifest correctly records no
usable direct filing rather than silently treating a search result as one. The
optional SearXNG branch is implemented but was not exercised locally because a
Docker/SearXNG service was unavailable; DDGS plus Trafilatura was the live
fallback. A fresh held-out run is required after direct SEC/MAYA acquisition is
proven. Until then, v2 is a stronger research system, not a validated final
price setter.
