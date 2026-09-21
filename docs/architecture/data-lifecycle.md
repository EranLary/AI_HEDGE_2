# Data lifecycle and sources of truth

This document defines where each class of data is created, which copy is
authoritative, and which copies are compatibility fallbacks. It describes the
current transitional architecture; it is not a proposal to delete fallbacks.

## Persistence map

| Data | Authoritative store | Secondary or transient copy | Main owners |
| --- | --- | --- | --- |
| Report catalog and list fields | Site Neon: `reports`, `tickers`, `report_releases` | Denormalized fields inside dashboard JSON | `src/ai_hedge/db/`, `frontend/src/lib/reports-db.ts` |
| Structured dashboard and report text | Site Neon: `report_artifacts` | Run directory under `outputs/`; selected objects in R2 | `src/ai_hedge/db/writer.py`, `src/ai_hedge/db/transform.py` |
| Downloadable/generated documents | Rendered from the saved report sources on request | Legacy files or R2 objects when a historical report points to them | artifact API route, `frontend/src/lib/report-document.tsx` |
| Site analysis status | `site_runs` for shared status/progress fields | `_status.json` for process-local fields and terminal fallback | `src/ai_hedge/io/status.py`, `frontend/src/lib/site-runs-db.ts` |
| Nasdaq universe orchestration | `nasdaq_universe_runs`, run items/attempts, releases | Worker-local run directory; R2 artifacts | `frontend/src/lib/nasdaq-runs-db.ts`, `scripts/nasdaq_universe_run.py` |
| Portfolio history | Portfolio snapshot, holding, NAV, price, and refresh tables | Provider responses during refresh | `frontend/src/lib/portfolio-db.ts` |
| Trading control plane | `trading_*` tables | Executor SQLite outbox/journal for delivery durability | `frontend/src/lib/trading-db.ts`, `trading_executor/` |
| LLM observability | Dedicated observability Neon database | Site DB fallback in local/legacy configurations | `src/ai_hedge/obs/`, `frontend-obs/` |
| Screener/provider caches | Versioned files below `outputs/_screeners/` | Upstream provider responses | screener scripts and API routes |

## Full-report write path

1. `runner.py` creates one ticker run directory and writes the canonical analysis,
   valuation input, dashboard JSON, and sidecar artifacts.
2. The configured artifact store receives each available file. Local mode returns
   the local path; R2 mode uploads immutable objects and returns object keys.
3. `write_run_to_db()` converts the run directory into a ticker row, a report row,
   and one `report_artifacts` row. The report and artifact insert share a DB
   transaction.
4. The site reads saved reports from Neon first. Analysis-workspace compatibility
   paths may scan `outputs/` when the DB is unavailable or a legacy row is absent.
5. HTML, Markdown, and PDF report documents are composed from the saved sources.
   Full-report PDFs are generated on demand and are not the canonical source.

An R2 upload does not by itself prove that a report was saved: the DB row and its
`r2_keys` must also be present. Likewise, a file in `outputs/` does not prove that
the report is visible on the site.

## Run-status precedence

Run status is currently a deliberate dual-write transition:

1. Python writes the full `_status.json` payload and best-effort shared fields to
   `site_runs`.
2. The site prefers the DB values for status, timestamps, progress, errors, and
   report ID.
3. The filesystem payload supplies process IDs, output paths, detailed results,
   and progress-log paths that are not stored in the DB.
4. If the filesystem has a terminal state and Neon still has a non-terminal state,
   the filesystem terminal state wins. This protects successful runs when the
   final best-effort DB update failed.

Do not remove either sink until all process-local fields have a replacement and
restart/cancellation tests cover the new single-store behavior.

## Invariants

- `analysis` reports have no release ID.
- `nasdaq100` reports belong to a matching staged/running release when inserted;
  readers expose only running or active releases.
- A report and its `report_artifacts` row are inserted together.
- Paper portfolio snapshots and holdings are immutable after insertion.
- R2 object keys include workspace, release/direct segment, ticker, and generation
  timestamp; bucket listing is not a public API.
- Observability credentials and migrations must target the observability database,
  not be inferred from report data.

## Schema management

- `src/ai_hedge/db/schema.sql` is the idempotent core-schema snapshot used to
  initialize a new database.
- `src/ai_hedge/db/migrations/` is the append-only history for existing databases.
- `scripts/db/bootstrap.py` applies the snapshot only when the core schema is
  completely absent, then applies every pending migration.
- `scripts/db/migrate.py` applies pending migrations only and is the production Fly
  release command.
- `scripts/db/audit.py` is read-only. It reports pending migrations, unknown
  tables, report/artifact integrity, and relation sizes.

Never edit a migration already recorded in `schema_migrations`. Add a new numbered
migration and verify both upgrade and empty-database bootstrap paths.

### Retired schema

Migration `016_archive_reverted_discovery_tables.sql` moves three tables from a
reverted Discovery performance feature out of `public` and into the `archive`
schema. The migration preserves every row and fails rather than overwrite an
existing archive relation. Current application code does not read or write these
tables; archived relations are retained only for recovery or historical review.

## Planned simplification boundary

The intended direction is DB-first catalog/status, R2 for immutable binary or
worker-produced objects, and `outputs/` as bounded working storage. That migration
must be incremental: measure reads, backfill pointers, test legacy reports, and
only then remove a filesystem fallback.
