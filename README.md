# AI_HEDGE_2

AI_HEDGE_2 is an AI-driven equity analysis platform with three active surfaces:

1. Python valuation engine (`run.py`, `run_lite.py`)
2. Public web app (`frontend/`, "Hedge in a Box")
3. Observability admin app (`frontend-obs/`)

The codebase has evolved far beyond a notebook port. This README documents the current project shape.

## What The Project Does

- Runs full ticker analysis and valuation from Python
- Produces analysis artifacts (text, PDF, charts, dashboard JSON)
- Stores report data in Neon Postgres
- Serves reports in the Next.js site
- Exposes Summary filing source links for latest annual and quarterly filings (SEC or MAYA)
- Tracks LLM run/call telemetry in the observability app

## Repo Layout

- `src/ai_hedge/legacy_port.py`: core valuation and prompt/parsing logic (high sensitivity file)
- `src/ai_hedge/runner.py`: orchestrates full valuation run and artifact creation
- `src/ai_hedge/dashboard.py`: dashboard payload generation
- `src/ai_hedge/service.py`: service layer used by site workflows
- `src/ai_hedge/maya_reports.py`: MAYA filing fetch for `.TA` tickers
- `src/ai_hedge/obs/`: observability instrumentation and DB writes
- `frontend/`: public dashboard site (Next.js)
- `frontend-obs/`: internal observability admin app (Next.js)
- `scripts/`: helper scripts used by site APIs (including filing status/PDF generation)
- `outputs/`: generated local artifacts (gitignored)

## Prerequisites

- Python 3.11 or 3.12
- Node.js 20+
- npm

## Environment Setup

1. Copy `.env.example` to `.env`
2. Fill required values

Minimum for valuation runs:

- `DEEPSEEK_API_KEY`

Common DB/auth variables used across the site and tooling:

- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED`
- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_URL`
- `OBS_DATABASE_URL`

For frontend local dev, keep app-specific values in:

- `frontend/.env.local`
- `frontend-obs/.env.local`

## Install Dependencies

Python:

```powershell
python -m pip install -r requirements.txt
```

Public site:

```powershell
cd frontend
npm install
```

Observability site:

```powershell
cd frontend-obs
npm install
```

## Run Locally

### Full valuation run

```powershell
python run.py --ticker AAPL --no-show-plots
```

Useful flags:

- `--pdf` / `--no-pdf`
- `--output-root outputs`
- `--analysis-workers <n>`
- `--llm-workers <n>`
- `--valuation-block-workers <n>`

### Lite/smoke valuation run

```powershell
python run_lite.py --ticker AAPL --no-show-plots
```

### Public app

```powershell
cd frontend
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`

### Observability app

```powershell
cd frontend-obs
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Open `http://127.0.0.1:3001`

## Artifacts Produced Per Ticker

A full run writes to `outputs/<TICKER>/` and typically includes:

- `<TICKER>_analysis.txt`
- `<TICKER>_analysis.pdf` (if enabled)
- `<TICKER>_prices_valuation.png`
- `<TICKER>_revenue_valuation.png`
- `<TICKER>_net_income_valuation.png`
- `<TICKER>_prices_explain.txt`
- `<TICKER>_prices_explain.pdf` (when generated)
- `<TICKER>_dashboard.json`
- `<TICKER>_technical_analysis.json`

## Filing Source Links (SEC and MAYA)

Summary page filing actions are source-link first:

- Annual source filing
- Quarterly source filing

Behavior:

- Uses ticker-level latest annual/latest quarterly filing
- Supports both SEC and MAYA
- MAYA relative URLs are normalized before redirecting
- Status fetch is cached and de-duplicated to reduce repeated upstream cost

## Database CLI Utilities

Use:

```powershell
python dbcli.py --help
```

This includes schema init, Fly snapshot fetch, scan/push/pull helpers, and report stats workflows.

## Deploy

### Manual Fly deploy

```powershell
.\deploy_fly.ps1 site
.\deploy_fly.ps1 obs
```

Status/logs:

```powershell
.\deploy_fly.ps1 status-site
.\deploy_fly.ps1 logs-site
.\deploy_fly.ps1 status-obs
.\deploy_fly.ps1 logs-obs
```

### GitHub Actions

- `.github/workflows/deploy-fly.yml`: deploys `site` and `obs` on push to `main`/`master`
- `.github/workflows/preview-site.yml`: per-PR site previews
- `.github/workflows/preview-obs.yml`: per-PR obs previews

## Development Notes

- `src/ai_hedge/legacy_port.py` is intentionally close to notebook behavior. Edit carefully.
- Do not commit generated files from `outputs/`, `logs/`, or `.env`.
- Theme/color system for `frontend/` is documented in `frontend/BRAND_COLORS.md`.
- PR-first workflow is mandatory in this repo (`AGENTS.md`).

