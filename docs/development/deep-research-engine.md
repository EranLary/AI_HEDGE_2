# Standalone Deep Research engine

This engine is intentionally independent of the existing analysis pipeline. It
must pass blind report-quality, valuation-compilation, and economic-audit gates
before any DB, dashboard, consensus, or product integration is considered.

## Credentials

Create a project-scoped OpenAI API key with billing and a spending limit. Add it
only to the repository-root `.env` file:

```dotenv
OPENAI_API_KEY=sk-...
```

The key must never be passed on the command line, written to artifacts, or
committed. API billing is separate from ChatGPT billing. Quality-first defaults
are documented in `.env.example`.

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

A report is publication-ready only when all of the following are true:

- deterministic report quality passes;
- semantic audit score is at least 85;
- no critical or major semantic issue remains;
- the valuation case compiles without errors;
- the economic case audit scores at least 85 with no critical or major issue.

The latest repair is never promoted merely because it is latest. Candidate
selection retains every version and ranks publication readiness and blockers
before scores.

## Main commands

Build the frozen snapshot, prompt, and redacted request without an API call:

```powershell
python scripts/run_deep_research.py --ticker IBKR --dry-run
```

Run the full narrative research and first-pass gates:

```powershell
python scripts/run_deep_research.py --ticker IBKR
```

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
