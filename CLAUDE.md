# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

AI-driven equity valuation pipeline ported from `AI_HEDGE_FUND_YF.ipynb`. Three surfaces share the same core:

- **CLI** (`run.py`) — run valuation for one ticker, write artifacts to `outputs/<TICKER>/`.
- **Telegram bot** (`bot/telegram_bot.py`) — thin wrapper around the valuation service with Stars billing.
- **Next.js dashboard** (`frontend/`) — "Hedge in a Box", reads `outputs/**/<TICKER>_dashboard.json` and renders the analysis.

Deployment target is Fly.io (two apps: `ai-hedge-telegram-bot`, `hedge-in-a-box-site`).

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
- [frontend/](frontend/) — Next.js 16 + React 19 + Tailwind 4 app.
- [outputs/](outputs/) — run artifacts per ticker (gitignored).
- [logs/](logs/) — bot logs (gitignored).
- [Dockerfile](Dockerfile) / [Dockerfile.site](Dockerfile.site) — Fly images (bot / site). Not needed for local dev.

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

Bot:
```powershell
py bot/telegram_bot.py
```

Outputs land in `outputs/<TICKER>/` (CLI) or `outputs/<job_id>/` (bot).

## Deploy

Fly scripts at repo root: `deploy-site.ps1`, `deploy-bot.ps1`, or unified `deploy_fly.ps1 {site|bot|status-*|logs-*}`. GitHub Actions at [.github/workflows/deploy-fly.yml](.github/workflows/deploy-fly.yml) auto-deploys both apps on push to `main`/`master` (needs `FLY_API_TOKEN` secret).

**Per-PR site previews.** [.github/workflows/preview-site.yml](.github/workflows/preview-site.yml) creates `pr-<N>-hedge-in-a-box-site.fly.dev` for any PR that touches `frontend/**`, `Dockerfile.site`, or `fly.site.toml`. The preview's `/data` volume is forked from the latest prod snapshot at PR open and kept for the life of the PR (staleness accepted). Machines auto-stop when idle. The app + volume are destroyed when the PR closes; [.github/workflows/preview-site-cleanup.yml](.github/workflows/preview-site-cleanup.yml) is a daily safety net that nukes preview apps older than 14 days.

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
