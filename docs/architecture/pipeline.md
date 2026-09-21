# Current analysis pipeline

This is the high-level runtime order for a full ticker analysis. The detailed
legacy-agent dependency map remains in `docs/architecture/dependency-map.md`; this document is
the current orchestration contract.

## Entrypoints

- CLI: `run.py` -> `ai_hedge.cli` -> `service.run_full_analysis()`.
- Site: run-analysis API -> `scripts/site_run.py` ->
  `service.run_full_analysis()`.
- Nasdaq worker: durable DB queue -> `scripts/nasdaq_universe_run.py` -> the same
  full-analysis service with `workspace='nasdaq100'` and a release ID.

## Full-run order

1. Validate ticker, workspace/release, API key, output directory, and concurrency.
2. Run the notebook-derived core analysis in `legacy_port.make_analysis_file()`:
   provider collection, filing/financial dictionaries, text agents, and F-score.
3. Start TradingAgents in parallel while the filing stages continue.
4. When filing text exists, create SEC/MAYA pre-score Q&A and the short filing
   summary. Otherwise record the explicit regular-analysis fallback.
5. Resolve share count and other deterministic inputs used by the valuation path.
6. Join TradingAgents and append its sanitized research context. Tactical rating,
   target, and horizon are kept outside valuation inputs.
7. Run complementary Web Search and append its evidence-backed report.
8. Extract the pre-valuation dashboard sections from analysis, filing, and
   financial context, then persist the exact valuation-input Markdown.
9. Run the valuation blocks in parallel and aggregate their structured results.
10. Build Wall St, Financials, and Technical Analysis sidecars; merge final
    analysis sections and the post-valuation TradingAgents decision.
11. Build and write the final dashboard JSON.
12. Upload available artifacts through the configured Local/R2 artifact store.
13. Persist the report catalog, dashboard/text sources, and R2 keys to Neon.

```text
Providers + filings
        |
        v
legacy core analysis -----> TradingAgents (parallel)
        |                         |
        +---- SEC/MAYA -----------+
        |                         |
        +---- share count --------+
                  |
                  v
             Web Search
                  |
                  v
      pre-valuation extraction
                  |
                  v
              valuations
                  |
                  v
   sidecars + final dashboard JSON
                  |
        +---------+---------+
        |                   |
        v                   v
  Local/R2 artifacts    Neon report rows
```

## Contract-sensitive boundaries

- `legacy_port.py` mirrors notebook behavior. Prefer adapters around it over broad
  prompt/parser refactors.
- The exact valuation input is persisted before valuation. Any enrichment meant
  to influence valuation must appear before that boundary; tactical output meant
  only for display must appear after it.
- `dashboard.py`, `db/transform.py`, persisted report columns, frontend types, and
  frontend normalization form one cross-language contract.
- Analysis and Nasdaq share most rendering code but not report visibility or
  release semantics. Test both workspaces after shared loader changes.
- A generated artifact is not fully published until its DB report row exists.

## Related documents

- Persistence: `docs/architecture/data-lifecycle.md`
- Detailed legacy dependencies: `docs/architecture/dependency-map.md`
- Nasdaq operations: `docs/operations/nasdaq100-workspace.md`
- Report rendering: `docs/architecture/html-first-reports.md`
- Validation: `docs/development/testing.md`
