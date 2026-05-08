# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

AI-driven equity valuation pipeline. Two surfaces share the same core:

- **CLI** (`run.py`) — run valuation for one ticker, write artifacts to `outputs/<TICKER>/`.
- **Next.js dashboard** (`frontend/`) — "Hedge in a Box", reads `outputs/**/<TICKER>_dashboard.json` and renders the analysis.

Deployment target is Fly.io (`hedge-in-a-box-site`).

## Layout

- [run.py](run.py) — CLI entry. Loads `.env`, adds `src/` to `sys.path`, calls `ai_hedge.cli.main`.
- [src/ai_hedge/](src/ai_hedge/) — core package:
  - [legacy_port.py](src/ai_hedge/legacy_port.py) — port of the original notebook (prompts, parsers, valuation flow). **Do not casually refactor** — it preserves notebook behavior.
  - [runner.py](src/ai_hedge/runner.py) — orchestrates a full run, writes artifacts + dashboard JSON.
  - [dashboard.py](src/ai_hedge/dashboard.py) — builds the dashboard payload consumed by the frontend.
  - [service.py](src/ai_hedge/service.py) — service layer.
  - [cli.py](src/ai_hedge/cli.py) — argparse wrapper.
- [frontend/](frontend/) — Next.js 16 + React 19 + Tailwind 4 app.
- [outputs/](outputs/) — run artifacts per ticker (gitignored).
- [logs/](logs/) — runtime logs (gitignored).
- [Dockerfile.site](Dockerfile.site) — Fly site image. Not needed for local dev.

## Required env

Copy `.env.example` to `.env` and fill in:

- `DEEPSEEK_API_KEY` — **required** for any valuation run (LLM calls).
- `ANALYSIS_WORKERS`, `LLM_WORKERS`, `VALUATION_BLOCK_WORKERS` — concurrency knobs, default 8 each in `runner.py`.

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

Outputs land in `outputs/<TICKER>/`.

## Deploy

Fly scripts at repo root: `deploy-site.ps1` or unified `deploy_fly.ps1 {site|status-site|logs-site|help}`. GitHub Actions at [.github/workflows/deploy-fly.yml](.github/workflows/deploy-fly.yml) auto-deploys the site on push to `main`/`master` (needs `FLY_API_TOKEN` secret).

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

**Backend-only PRs** (Python under [src/](src/)) do not get a preview environment. Verify locally — `python run.py --ticker AAPL` for valuation changes. State this in the PR's "Test plan" so the reviewer knows what coverage to expect.

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
- Don't run `pip install` in the Docker image's build context expecting to persist `outputs/` — the Fly container symlinks `/app/outputs` → `/data/outputs` at startup.
