# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

AI-driven equity valuation pipeline ported from `AI_HEDGE_FUND_YF.ipynb`. Four surfaces share the same core:

- **CLI** (`run.py`) — run valuation for one ticker, write artifacts to `outputs/<TICKER>/`.
- **Telegram bot** (`bot/telegram_bot.py`) — thin wrapper around the valuation service with Stars billing.
- **Next.js dashboard** (`frontend/`) — "Hedge in a Box", customer-facing site at `hedge-in-a-box.com`. Reads `outputs/**/<TICKER>_dashboard.json` and renders the analysis.
- **Observability app** (`frontend-obs/`) — internal-only admin app at `observability.hedge-in-a-box.com`. Reads `obs_runs` / `obs_calls` from the obs Neon DB and renders the LLM call DAG. DB-backed admin allowlist (`obs_admins` table) editable from `/users` — no env-var allowlist.

Deployment target is Fly.io (three apps: `ai-hedge-telegram-bot`, `hedge-in-a-box-site`, `hedge-in-a-box-obs`).

## Layout

- [run.py](run.py) — CLI entry. Loads `.env`, adds `src/` to `sys.path`, calls `ai_hedge.cli.main`.
- [run_lite.py](run_lite.py) — lite variant for quick checks.
- [src/ai_hedge/](src/ai_hedge/) — core package:
  - [legacy_port.py](src/ai_hedge/legacy_port.py) — notebook port (prompts, parsers, valuation flow). **Do not casually refactor** — it preserves notebook behavior.
  - [runner.py](src/ai_hedge/runner.py) — orchestrates a full run, writes artifacts + dashboard JSON.
  - [dashboard.py](src/ai_hedge/dashboard.py) — builds the dashboard payload consumed by the frontend.
  - [service.py](src/ai_hedge/service.py) — service layer used by the bot.
  - [cli.py](src/ai_hedge/cli.py) — argparse wrapper.
- [bot/](bot/) — Telegram bot: `telegram_bot.py` (entry), `handlers.py`, `jobs.py`, `worker.py`, `billing.py`.
- [frontend/](frontend/) — Next.js 16 + React 19 + Tailwind 4 app (public site).
- [frontend-obs/](frontend-obs/) — Next.js 16 observability admin app. Independent NextAuth (Google), DB-backed admin allowlist via `obs_admins`. No persistent volume — reads from Neon only.
- [outputs/](outputs/) — run artifacts per ticker (gitignored).
- [logs/](logs/) — bot logs (gitignored).
- [Dockerfile](Dockerfile) / [Dockerfile.site](Dockerfile.site) / [Dockerfile.obs](Dockerfile.obs) — Fly images (bot / site / obs). Not needed for local dev.

## Required env

Copy `.env.example` to `.env` and fill in:

- `DEEPSEEK_API_KEY` — **required** for any valuation run (LLM calls).
- `TELEGRAM_BOT_TOKEN` — required only for running the bot locally.
- `ANALYSIS_WORKERS`, `LLM_WORKERS`, `VALUATION_BLOCK_WORKERS` — concurrency knobs, default 8 each in `runner.py`.
- `BOT_MAX_WORKERS` — bot job concurrency.
- Optional bot billing: `VALUATION_PRICE_STARS`, `SEC_PRICE_STARS`, `BOT_FREE_PASSWORD`.

## Run locally

CLI:
```powershell
python run.py --ticker AAPL --pdf
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

Bot:
```powershell
py bot/telegram_bot.py
```

Outputs land in `outputs/<TICKER>/` (CLI) or `outputs/<job_id>/` (bot).

## Deploy

Fly scripts at repo root: `deploy-site.ps1`, `deploy-bot.ps1`, `deploy-obs.ps1`, or unified `deploy_fly.ps1 {site|bot|obs|status-*|logs-*}`. GitHub Actions at [.github/workflows/deploy-fly.yml](.github/workflows/deploy-fly.yml) auto-deploys site and obs on push to `main`/`master` (needs `FLY_API_TOKEN` secret). The obs job no-ops gracefully until `flyctl apps create hedge-in-a-box-obs` has been run once.

**Observability app first-time setup** (one-shot, manual):
1. `flyctl apps create hedge-in-a-box-obs --org <org>`
2. `flyctl secrets set -a hedge-in-a-box-obs AUTH_SECRET=<new> AUTH_GOOGLE_ID=<existing> AUTH_GOOGLE_SECRET=<existing> OBS_DATABASE_URL=<existing> AUTH_URL=https://observability.hedge-in-a-box.com`
3. Add `https://observability.hedge-in-a-box.com/api/auth/callback/google` (and `http://localhost:3001/api/auth/callback/google` for dev) to the existing Google OAuth client's authorized redirect URIs.
4. `flyctl certs add observability.hedge-in-a-box.com -a hedge-in-a-box-obs`
5. Add CNAME at DNS provider: `observability.hedge-in-a-box.com → hedge-in-a-box-obs.fly.dev`. Cert auto-issues.
6. Apply [src/ai_hedge/db/migrations/003_obs_admins.sql](src/ai_hedge/db/migrations/003_obs_admins.sql) against `OBS_DATABASE_URL` (replace TBD seed emails first).

**Per-PR site previews.** [.github/workflows/preview-site.yml](.github/workflows/preview-site.yml) creates `pr-<N>-hedge-in-a-box-site.fly.dev` for any PR that touches `frontend/**`, `Dockerfile.site`, or `fly.site.toml`. The preview's `/data` volume is forked from the latest prod snapshot at PR open and kept for the life of the PR (staleness accepted). Machines auto-stop when idle. The app + volume are destroyed when the PR closes; [.github/workflows/preview-site-cleanup.yml](.github/workflows/preview-site-cleanup.yml) is a daily safety net that nukes preview apps older than 14 days.

## Workflow (PR-first, no direct pushes to main)

**Hard rule: never commit or push directly to `main`/`master`.** Every change — including agent-driven changes — goes through a pull request. A merge to `main` triggers a prod deploy via [.github/workflows/deploy-fly.yml](.github/workflows/deploy-fly.yml); we don't want that surface lit up by ad-hoc pushes.

The flow:

1. Branch off `main`: `git checkout main && git pull && git checkout -b <type>/<short-desc>` (e.g. `feat/discovery-filters`, `fix/sec-pagination`).
2. Commit changes on that branch.
3. Push: `git push -u origin <branch>`.
4. Open a PR: `gh pr create --title "..." --body "..."`. Use the PR template; fill in the preview URL line if applicable.
5. For **frontend / `Dockerfile.site` / `fly.site.toml`** PRs, the preview workflow auto-deploys `pr-<N>-hedge-in-a-box-site.fly.dev` and posts a sticky comment with the URL. **Verify the change on the preview** before requesting review.
6. Merge via squash (keeps `main` history linear). Closing the PR tears down the preview.

**Backend-only PRs** (Python under [src/](src/), [bot/](bot/)) do not get a preview environment. Verify locally — `python run.py --ticker AAPL` for valuation changes, `py bot/telegram_bot.py` against a staging Telegram bot for bot changes. State this in the PR's "Test plan" so the reviewer knows what coverage to expect.

**Branch hygiene — start every task from a clean `main`.** Before making any code change, check the current branch (`git branch --show-current`) and working-tree state (`git status`). If you're sitting on a feature branch from a prior task, do **not** pile the new work onto it — that branch belongs to a different PR and mixing changes will pollute its diff. Always `git checkout main && git pull` and branch off fresh, unless the user explicitly asks you to amend or extend a specific existing PR.

**Exceptions to the no-direct-push rule** are explicit, narrow, and human-authorized: a destructive `main` recovery, a CI-fix that unbreaks the deploy pipeline. Agents must not infer the exception themselves — ask the user first.

## Conventions

- Python target is 3.11+ (Docker uses 3.12-slim).
- PowerShell is the assumed local shell on Windows — helper scripts (`deploy-*.ps1`, `push-git.ps1`) are PowerShell-first with `.cmd` shims.
- Don't edit `legacy_port.py` prompts/parsers unless intentionally changing model behavior — it mirrors the notebook.
- Frontend reads artifacts directly from disk under `outputs/` — keep JSON schema in `dashboard.py` in sync with the frontend loaders in `frontend/src/`.
- `outputs/`, `logs/`, `.env` are gitignored. Don't commit generated artifacts.
- **Frontend theming.** The Next.js app supports light + dark via `html[data-theme]`. Color tokens, contrast rules, and the do/don't list live in [frontend/BRAND_COLORS.md](frontend/BRAND_COLORS.md). Read it before adding any color, chart, or theme-sensitive component. Do not introduce hex/rgb literals in `.tsx`/`.ts` — add a token to [frontend/src/app/globals.css](frontend/src/app/globals.css) first and reference it via `var(--token)` or a Tailwind utility.

## Don't

- Don't bump Python to 3.13+ without checking `weasyprint` / `python-pptx` wheels.
- Don't swap `python-telegram-bot` off the `[job-queue]` extra — `telegram_bot.py` fails fast if the JobQueue isn't available.
- Don't run `pip install` in the Docker image's build context expecting to persist `outputs/` — the Fly container symlinks `/app/outputs` → `/data/outputs` at startup.
