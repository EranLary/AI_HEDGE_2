# Hybrid research harness

The analysis service exposes two versioned engines through the same runner and
report contract:

- `deterministic_v1` is the default and preserves the existing pipeline.
- `hybrid_v1` wraps that pipeline in a typed, append-only research state. It is
  available only in the Analysis workspace and must be explicitly enabled.

Nasdaq releases remain deterministic. A Hybrid failure is never retried through
the deterministic engine without a new, explicit request.

## Invocation and rollout gate

`POST /api/run-analysis` accepts an optional `engine` field. Missing means
`deterministic_v1`; unknown engines return HTTP 400. Hybrid requests return HTTP
409 until `HYBRID_RUN_ANALYSIS_ENABLED=1`. The client-side selector is shown
only when `NEXT_PUBLIC_HYBRID_RUN_ANALYSIS_ENABLED=1` is also present at build
time.

The CLI and site runner use the same contract:

```text
python run.py --ticker AAPL --engine deterministic_v1
python scripts/site_run.py --ticker AAPL --engine hybrid_v1 --job-id <id>
```

## State and source of truth

`src/ai_hedge/harness/` owns the engine registry, Pydantic contracts, budget
enforcement, source/evidence/claim capture, deterministic reconciliation, and
artifact generation. Migration 021 adds the normalized catalog:

- `research_runs` and `research_stage_runs` record identity, versions, hashes,
  dependencies, duration, provider/model metadata, budget use, and errors.
  `run_mode` (`live`, `shadow`, or `replay`) and
  `baseline_research_run_id` link paired evaluations without conflating them.
- `research_sources` and `research_evidence` record canonical sources and exact
  locators/excerpts.
- `research_claims`, `research_claim_evidence`, and
  `research_claim_relations` preserve facts, assumptions, inferences,
  conclusions, provenance, support, and contradiction edges.
- `research_contradictions` and `research_sensitivity_scenarios` preserve every
  candidate and the deterministic provisional selection.

Neon is the authoritative catalog. Large immutable artifacts are uploaded to R2
and referenced through `report_artifacts.r2_keys`. Local files remain runtime
working copies and compatibility fallbacks:

- `<TICKER>_research_state.json`
- `<TICKER>_execution_manifest.json`
- `<TICKER>_evidence_ledger.jsonl`
- `<TICKER>_contradictions.json`
- `<TICKER>_valuation_sensitivity.json`
- `<TICKER>_research_source_bodies.jsonl` (large immutable source bodies)
- `_harness/checkpoints/latest.json` plus one immutable local checkpoint per stage

`analysis.md` remains the report-source compatibility contract and
`valuation_input.md` remains the immutable valuation boundary. Existing
valuation formulas, model gates, and deterministic calculations are unchanged.

## Budgets and bounded agency

Hybrid reuses the existing read-only isolated Web Research worker. It may run up
to three gap cycles and six searches per cycle. Four independent limits are
stored in the run config snapshot and enforced before another cycle begins:

| Environment variable | Default | Hard model bound |
| --- | ---: | ---: |
| `HYBRID_MAX_DURATION_SECONDS` | 7200 | 10800 |
| `HYBRID_MAX_GAP_CYCLES` | 3 | 4 |
| `HYBRID_MAX_SEARCH_QUERIES` | 18 | 30 |
| `HYBRID_MAX_COST_USD` | 10 | 25 |

Shadow/replay infrastructure may additionally set `HYBRID_RUN_MODE` and
`HYBRID_BASELINE_RESEARCH_RUN_ID`; normal user runs leave them at `live` and
unset, respectively.

External source text is data only. It is persisted as evidence and never gains
tool authority, changes formulas, or overrides system instructions.

## Conflicts and downstream eligibility

Claims are grouped by canonical key. Reconciliation ranks candidates by source
authority and confidence and keeps all alternatives. Numeric equality uses a
deterministic 0.5% tolerance. A material unresolved conflict produces
`amber_conflict`, selects a provisional input by deterministic rules, emits
sensitivity-input records, and sets `automation_eligible=false`.

Ineligible reports remain readable but are excluded from Discovery, Hit Rate,
Jev track-record/rankings, portfolio snapshots, and trading automation. Runs
that exhaust a budget are explicitly marked `budget_exhausted`; they do not
silently fall back to the other engine.

Sensitivity rows always retain every candidate input. Share-count alternatives
also receive an exact denominator-only target-price recalculation and percentage
impact. Other critical inputs remain explicitly `pending` until the underlying
valuation family can be rerun with a fully normalized alternative packet; they
are never presented as calculated impacts.

## Audit surface

`GET /api/reports/[id]/audit` returns the persisted run, stages, sources,
evidence, claims, relations, conflicts, and sensitivity inputs. The Analysis
dashboard exposes the same data at `/dashboard/[ticker]/audit`. Version 1 is
read-only; a future human correction must create a new append-only revision,
not mutate historical claims.

## Validation

At minimum, changes to the harness require:

```text
python scripts/db/migrate.py --dry-run
scripts/verify.cmd -Scope backend
scripts/verify.cmd -Scope frontend
```

Use fixed provider snapshots for paired deterministic/Hybrid replay. The
deterministic path must retain its golden outputs. Hybrid promotion remains
feature-flagged until the evaluation corpus passes evidence coverage, silent
overwrite, factual accuracy, latency, and cost gates.

The versioned 20-company corpus and its machine-readable gates live in
`tests/fixtures/hybrid_research_corpus_v1.json`. Eight entries are marked as
hard cases and require three repeated Hybrid runs once snapshot replay is wired
into the shadow runner.
