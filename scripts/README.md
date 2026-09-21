# Script layout

Scripts are grouped by ownership while runtime entrypoints keep their stable
paths because the Next.js routes, Docker images, or operator workflows invoke
them directly.

- `db/`: schema bootstrap, migrations, audits, backfills, and the DB CLI.
- `deploy/`: manual Fly deployment, status, and log helpers.
- `dev/`: local development helpers that are not used in production.
- `docs/`: generators for checked-in architecture diagrams.
- `verify.cmd` / `verify.ps1`: the supported local validation entrypoint.
- Files directly under `scripts/`: runtime or product operations with existing
  callers, such as site runs, Nasdaq workers, provider lookups, and report
  rendering.

Before moving a root-level runtime script, search its callers across Python,
Next.js, Dockerfiles, Fly configuration, and GitHub Actions. Update all callers
in the same PR.
