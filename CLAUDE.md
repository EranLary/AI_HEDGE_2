# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

AI-driven equity research and portfolio platform evolved from
`AI_HEDGE_FUND_YF.ipynb`. The current system has five runtime domains:

- **Analysis core and CLI** (`src/ai_hedge/`, `run.py`) — run analysis for one ticker and write working artifacts below `outputs/`.
- **Public site and control plane** (`frontend/`) — "Hedge in a Box" at `hedge-in-a-box.com`; serves saved research, starts site/Nasdaq work, tracks portfolios, and owns the server side of Paper trading.
- **Nasdaq worker** (`scripts/nasdaq_worker_server.py`) — consumes durable Nasdaq run work and executes the same full-analysis service with release isolation.
- **Observability app** (`frontend-obs/`) — internal-only admin app at `observability.hedge-in-a-box.com`; reads the dedicated observability Neon DB and renders the LLM call DAG.
- **IBKR Paper executor** (`trading_executor/`) — Windows process and the only component that contacts IB Gateway. Credentials remain local; the site supplies a DB-backed control plane.

Deployment target is Fly.io (three apps: `hedge-in-a-box-site`, `hedge-in-a-box-obs`, and the scale-to-zero `hedge-in-a-box-nasdaq-worker`).

Current topology, runtime order, and persistence ownership are documented in
[`docs/architecture/system-map.md`](docs/architecture/system-map.md),
[`docs/architecture/pipeline.md`](docs/architecture/pipeline.md), and
[`docs/architecture/data-lifecycle.md`](docs/architecture/data-lifecycle.md).

## Layout

- [run.py](run.py) — CLI entry. Loads `.env`, adds `src/` to `sys.path`, calls `ai_hedge.cli.main`.
- [run_lite.py](run_lite.py) — lite variant for quick checks.
- [src/ai_hedge/](src/ai_hedge/) — core package:
  - [legacy_port.py](src/ai_hedge/legacy_port.py) — notebook port (prompts, parsers, valuation flow). **Do not casually refactor** — it preserves notebook behavior.
  - [runner.py](src/ai_hedge/runner.py) — orchestrates a full run, writes artifacts + dashboard JSON.
  - [dashboard.py](src/ai_hedge/dashboard.py) — builds the dashboard payload consumed by the frontend.
  - [service.py](src/ai_hedge/service.py) — shared full-analysis service used by CLI, site runs, and the Nasdaq worker.
  - [cli.py](src/ai_hedge/cli.py) — argparse wrapper.
- [frontend/](frontend/) — Next.js 16 + React 19 + Tailwind 4 app (public site).
- [frontend-obs/](frontend-obs/) — Next.js 16 observability admin app. Independent NextAuth (Google), DB-backed admin allowlist via `obs_admins`. No persistent volume — reads from Neon only.
- [trading_executor/](trading_executor/) — local Windows IBKR Paper executor with DPAPI-protected configuration and a durable SQLite outbox.
- `outputs/` — generated run artifacts per ticker (gitignored; created on demand).
- `logs/` — local/runtime logs (gitignored; created on demand).
- [Dockerfile.site](Dockerfile.site) / [Dockerfile.obs](Dockerfile.obs) / [Dockerfile.nasdaq-worker](Dockerfile.nasdaq-worker) — Fly images for the three deployed apps. Not needed for local dev.

## Required env

Copy `.env.example` to `.env` and fill in:

- `DEEPSEEK_API_KEY` — **required** for any valuation run (LLM calls).
- `ANALYSIS_WORKERS`, `LLM_WORKERS`, `VALUATION_BLOCK_WORKERS` — concurrency knobs, default 8 each in `runner.py`.

## Run locally

CLI:
```powershell
python run.py --ticker AAPL --no-show-plots
```

Frontend:
```powershell
cd frontend
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Observability app:
```powershell
cd frontend-obs
npm run dev -- --hostname 127.0.0.1 --port 3001
```
Local dev bypasses auth on `localhost`/`127.0.0.1` (gated by `AUTH_BYPASS_LOCAL`). For full sign-in testing, set `AUTH_BYPASS_LOCAL=0` and ensure `http://localhost:3001/api/auth/callback/google` is on the Google OAuth client's redirect URIs.

Outputs land in `outputs/<TICKER>/` for direct CLI runs and
`outputs/_site_runs/<job_id>/<TICKER>/` for site-triggered runs.

## Deploy

Fly helpers live under `scripts/deploy/`: use
`scripts/deploy/deploy_fly.ps1 {site|obs|status-*|logs-*}`, or the focused site
and obs wrappers. GitHub Actions at
[.github/workflows/deploy-fly.yml](.github/workflows/deploy-fly.yml) auto-deploys
site, observability, and the Nasdaq worker on pushes to `main`/`master` (needs
`FLY_API_TOKEN` and the service-specific secrets).

**Observability app first-time setup** (one-shot, manual):
1. `flyctl apps create hedge-in-a-box-obs --org <org>`
2. `flyctl secrets set -a hedge-in-a-box-obs AUTH_SECRET=<new> AUTH_GOOGLE_ID=<existing> AUTH_GOOGLE_SECRET=<existing> OBS_DATABASE_URL=<existing> AUTH_URL=https://observability.hedge-in-a-box.com`
3. Add `https://observability.hedge-in-a-box.com/api/auth/callback/google` (and `http://localhost:3001/api/auth/callback/google` for dev) to the existing Google OAuth client's authorized redirect URIs.
4. `flyctl certs add observability.hedge-in-a-box.com -a hedge-in-a-box-obs`
5. Add CNAME at DNS provider: `observability.hedge-in-a-box.com → hedge-in-a-box-obs.fly.dev`. Cert auto-issues.
6. Apply [src/ai_hedge/db/migrations/003_obs_admins.sql](src/ai_hedge/db/migrations/003_obs_admins.sql) against `OBS_DATABASE_URL` (replace TBD seed emails first).

**Per-PR site previews.** [.github/workflows/preview-site.yml](.github/workflows/preview-site.yml) creates `pr-<N>-hedge-in-a-box-site.fly.dev` for any PR that touches `frontend/**`, `Dockerfile.site`, or `fly.site.toml`. Auth is **bypassed** on these previews (`AUTH_BYPASS_PREVIEW=1`) because Google OAuth doesn't permit wildcard redirect URIs for per-PR hostnames — anyone with the URL gets signed-in access, so don't share it externally. The preview's `/data` volume is forked from the latest prod snapshot at PR open and kept for the life of the PR (staleness accepted). The preview's site DB is a Neon branch named `pr-<N>` off `main` in the `ai-hedge` Neon project — previews can mutate freely without touching prod. The preview's **obs DB is the prod obs DB** (no branching) — pipeline runs from a site preview write `obs_runs` / `obs_calls` rows directly to prod, but with `obs_runs.source = "preview-pr-<N>"` (set via the `OBS_RUN_SOURCE_LABEL` env var the workflow injects, honored in [src/ai_hedge/obs/db.py](src/ai_hedge/obs/db.py)) so they're trivially filterable from real `cli`/`site` rows. The wiring requires a GitHub Actions repo secret `OBS_DATABASE_URL` (same value as the prod Fly secret on `hedge-in-a-box-obs`); if missing, the workflow logs a warning and obs writes silently no-op against the branched site DB. Machines auto-stop when idle. The Fly app, volume, and Neon site branch are destroyed when the PR closes; [.github/workflows/preview-site-cleanup.yml](.github/workflows/preview-site-cleanup.yml) is a daily safety net that nukes both Fly preview apps and orphaned Neon `pr-*` branches older than 14 days.

**Per-PR obs previews.** [.github/workflows/preview-obs.yml](.github/workflows/preview-obs.yml) creates `pr-<N>-hedge-in-a-box-obs.fly.dev` for any PR that touches `frontend-obs/**`, `Dockerfile.obs`, or `fly.obs.toml`. Auth is **bypassed** on these previews (`AUTH_BYPASS_PREVIEW=1`) because Google OAuth doesn't permit wildcard redirect URIs for per-PR hostnames — anyone with the URL gets admin access, so don't share it externally. The preview's DB is a Neon branch named `pr-<N>` off `production` in the `hedge_obs` Neon project (forked at PR open, deleted on close). No persistent volume; machines auto-stop when idle; app destroyed on PR close.

**Schema drift on previews.** Neon branches inherit prod's schema at fork time.
The site-preview workflow runs `python scripts/db/migrate.py` against the preview
branch before deployment. A migration PR must still validate the empty-database
bootstrap and the upgrade path locally/CI; the workflow does not prove that a
fresh database can be reconstructed.

## Workflow (PR-first, no direct pushes to main)

**Hard rule: never commit or push directly to `main`/`master`.** Every change — including agent-driven changes — goes through a pull request. A merge to `main` triggers a prod deploy via [.github/workflows/deploy-fly.yml](.github/workflows/deploy-fly.yml); we don't want that surface lit up by ad-hoc pushes.

The flow:

1. Branch off `main`: `git checkout main && git pull && git checkout -b <type>/<short-desc>` (e.g. `feat/discovery-filters`, `fix/sec-pagination`).
2. Commit changes on that branch.
3. Push: `git push -u origin <branch>`.
4. Open a PR: `gh pr create --title "..." --body "..."`. Use the PR template; fill in the preview URL line if applicable.
5. For **frontend / `Dockerfile.site` / `fly.site.toml`** PRs, the preview workflow auto-deploys `pr-<N>-hedge-in-a-box-site.fly.dev` and posts a sticky comment with the URL. **Verify the change on the preview** before requesting review.
6. Merge via squash (keeps `main` history linear). Closing the PR tears down the preview.

**Python changes under `src/` trigger the site preview environment.** Verify them
locally first, then verify the affected preview route/API. Changes only under
tests, docs, or unlisted scripts may not trigger a preview; state the local
coverage explicitly in the PR's "Test plan".

**Obs PRs** (changes under [frontend-obs/](frontend-obs/), [Dockerfile.obs](Dockerfile.obs), [fly.obs.toml](fly.obs.toml)) get a per-PR preview at `pr-<N>-hedge-in-a-box-obs.fly.dev` via [.github/workflows/preview-obs.yml](.github/workflows/preview-obs.yml). **Auth is bypassed on previews** — the URL is admin-equivalent for anyone who has it, so don't paste it into public channels. **Verify the change on the preview** before requesting review. **Merging to `main` deploys directly to `observability.hedge-in-a-box.com` via the `deploy-obs` job in [.github/workflows/deploy-fly.yml](.github/workflows/deploy-fly.yml).** Treat it like the public site's deploy — small, focused PRs only.

**Branch hygiene — start every task from a clean `main`.** Before making any code change, check the current branch (`git branch --show-current`) and working-tree state (`git status`). If you're sitting on a feature branch from a prior task, do **not** pile the new work onto it — that branch belongs to a different PR and mixing changes will pollute its diff. Always `git checkout main && git pull` and branch off fresh, unless the user explicitly asks you to amend or extend a specific existing PR.

**Exceptions to the no-direct-push rule** are explicit, narrow, and human-authorized: a destructive `main` recovery, a CI-fix that unbreaks the deploy pipeline. Agents must not infer the exception themselves — ask the user first.

## Conventions

- Python target is 3.11+ (Docker uses 3.12-slim).
- PowerShell is the assumed local shell on Windows. Operator helpers live under
  `scripts/deploy/`, development helpers under `scripts/dev/`, and validation
  starts at `scripts/verify.cmd`.
- Don't edit `legacy_port.py` prompts/parsers unless intentionally changing model behavior — it mirrors the notebook.
- Frontend reads persisted reports from Neon first and uses `outputs/` for
  compatibility/local fallbacks. Keep the JSON contract in `dashboard.py`,
  `db/transform.py`, persisted report columns, and frontend loaders/types in sync.
- `outputs/`, `logs/`, `.env` are gitignored. Don't commit generated artifacts.
- **Frontend theming.** The Next.js app supports light + dark via `html[data-theme]`. Color tokens, contrast rules, and the do/don't list live in [frontend/BRAND_COLORS.md](frontend/BRAND_COLORS.md). Read it before adding any color, chart, or theme-sensitive component. Do not introduce hex/rgb literals in `.tsx`/`.ts` — add a token to [frontend/src/app/globals.css](frontend/src/app/globals.css) first and reference it via `var(--token)` or a Tailwind utility.

## Don't

- Don't bump Python to 3.13+ without checking `weasyprint` / `python-pptx` wheels.
- Don't run `pip install` in the Docker image's build context expecting to persist `outputs/` — the Fly container symlinks `/app/outputs` → `/data/outputs` at startup.
