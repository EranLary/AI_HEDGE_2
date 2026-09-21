# Validation guide

Use the smallest scope that fully covers a change, then add broader checks when a
shared contract is affected. Windows PowerShell is the primary local shell.

## One-command runner

```powershell
.\scripts\verify.cmd -Scope backend
.\scripts\verify.cmd -Scope frontend
.\scripts\verify.cmd -Scope obs
.\scripts\verify.cmd -Scope db
.\scripts\verify.cmd -Scope all
```

`db` is read-only against the configured database. It checks pending migrations
and runs the DB audit; it never applies a migration. `all` omits the live DB check
unless `-IncludeLiveDb` is supplied.

## Underlying commands

### Backend

```powershell
python -m pytest -q --basetemp=.tmp/pytest
```

For a focused change, run the relevant test module first. Keep all temporary
pytest output below `.tmp/`; do not create new root-level basetemp directories.

### Public frontend

From `frontend/`:

```powershell
npm.cmd exec -- eslint <changed-file-1> <changed-file-2>
npm.cmd run test:middleware
npm.cmd run test:reports
npm.cmd run test:portfolio
npm.cmd run build
```

`verify.cmd` derives the changed frontend files from `origin/main...HEAD` plus
uncommitted changes. Whole-tree `npm.cmd run lint` remains useful as an audit,
but it is not the PR gate until the existing repository-wide React lint backlog
is cleared.

Run `npm.cmd run build` after shared types, route handlers, server loaders, or
configuration changes even when focused lint/tests pass.

### Observability frontend

From `frontend-obs/`:

```powershell
npm.cmd exec -- eslint <changed-file-1> <changed-file-2>
npm.cmd run build
```

The same changed-file lint policy applies while the existing whole-tree React
lint backlog is being retired.

### Database

```powershell
python scripts/migrate.py --dry-run
python scripts/db_audit.py --strict
```

Unexpected live tables are reported but do not fail the normal audit, because
they may contain legacy data that requires an ownership decision. Add
`--fail-on-unexpected` for a disposable/fresh database; CI uses it after
bootstrap.

For a new migration, also validate an empty database with:

```powershell
python scripts/bootstrap_db.py --db-url <temporary-postgres-url>
python scripts/migrate.py --db-url <temporary-postgres-url> --dry-run
python scripts/db_audit.py --db-url <temporary-postgres-url> --strict
```

Never use production for bootstrap testing.

## Preview requirements

- Changes under `frontend/**`, `src/**`, `requirements.txt`, `Dockerfile.site`,
  or `fly.site.toml` trigger a site preview. Verify affected routes and APIs there.
- Changes under `frontend-obs/**`, `Dockerfile.obs`, or `fly.obs.toml` trigger an
  observability preview.
- Preview authentication is bypassed. Treat preview URLs as sensitive.
- Shared report/document changes require Analysis, Valuation, and Combined checks.
- Shared workspace loaders require both Analysis and Nasdaq checks.

Record exact commands and the preview surfaces checked in the PR test plan.
