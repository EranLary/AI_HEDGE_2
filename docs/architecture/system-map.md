# Current system map

AI_HEDGE_2 started as a notebook-based valuation pipeline. It is now a platform
with separate research, web, worker, observability, portfolio, and execution
responsibilities. This document defines the current boundaries; it is not a map
of every module.

## Runtime topology

```text
                         +-----------------------+
Users -----------------> | Public site           |
                         | frontend/             |
                         +----+-------------+----+
                              |             |
                    report and|             |durable Nasdaq work
                    trading   |             v
                    control   |      +--------------------+
                              |      | Nasdaq worker      |
                              |      | Fly, scale to zero |
                              |      +---------+----------+
                              |                |
                              v                v
                         +-----------------------+
CLI -------------------> | Shared analysis core  |
                         | src/ai_hedge/          |
                         +----+-------------+----+
                              |             |
                              v             v
                         Site Neon      Local/R2 artifacts

Site / worker / analysis --------> Observability Neon --------> Obs app

Site trading control <-----------> Site Neon
        |
        +------------------------> IBKR Paper executor --------> IB Gateway
```

## Ownership boundaries

### Shared analysis core

`src/ai_hedge/` owns provider collection, filing analysis, model prompts,
valuation, dashboard construction, artifact publication, and report persistence.
The CLI, site-run process, and Nasdaq worker are adapters around this core.
`legacy_port.py` intentionally preserves notebook behavior and is a
high-sensitivity compatibility boundary.

### Public site and control plane

`frontend/` reads report and portfolio state from the site Neon database. It
starts Analysis runs, creates durable Nasdaq work, refreshes portfolio history,
and exposes the server-side Paper trading control API. It does not connect to IB
Gateway and must never receive broker passwords or 2FA responses.

### Nasdaq worker

The Fly worker consumes durable queue state, runs the shared analysis core with
`workspace='nasdaq100'` and a release ID, uploads immutable artifacts to R2, and
persists the report catalog in Neon. It has no independent customer-facing UI.

### Observability

Analysis processes write LLM run/call telemetry to a dedicated observability
Neon database. `frontend-obs/` reads that database and is deployed separately
from the public site.

### IBKR Paper execution

`trading_executor/` runs under a dedicated Windows user and is the only process
that connects to IB Gateway. It polls the site's DB-backed control plane, keeps
its own SQLite outbox/journal for delivery safety, and reports results back to
the site. It is Paper-only and is not a Fly deployment.

## Deployment and persistence

- Fly deploys three apps: the public site, observability app, and Nasdaq worker.
- The IBKR Paper executor is installed separately on a persistent Windows host.
- Site Neon is authoritative for reports, releases, portfolios, and trading
  state; observability uses its own Neon database.
- R2 stores immutable worker artifacts. `outputs/` is bounded working storage and
  a compatibility fallback, not proof that a report is published.
- There is no active Telegram bot application. The site may send Telegram
  notifications for trading alerts.

For detailed sequencing and storage rules, see
[pipeline.md](pipeline.md) and [data-lifecycle.md](data-lifecycle.md).
