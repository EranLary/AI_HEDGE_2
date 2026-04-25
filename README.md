# AI Hedge Notebook Port (Ticker Valuation)

This project ports the notebook logic into a runnable modular structure while preserving the original valuation flow and prompts/parsers in `src/ai_hedge/legacy_port.py`.

## What it does now
- Accepts a ticker input
- Runs the same analysis + valuation pipeline
- Saves 3 valuation plots:
  - prices valuation
  - revenue valuation
  - net income valuation
- Optionally generates PDF from analysis text (`--pdf`)

## Setup
1. Install dependencies:
   ```powershell
   pip install -r requirements.txt
   ```
2. Set API key:
   ```powershell
   $env:DEEPSEEK_API_KEY="your_key_here"
   ```

## Run
```powershell
python run.py --ticker AAPL --pdf
```

Optional flags:
- `--output-root outputs`
- `--show-plots`

Valuation flow uses a single combined-context pass (regular text + SEC short when available).

Outputs are saved under `outputs/<TICKER>/`.

## Hedge in a Box Dashboard (Next.js)

The repository now includes a dashboard web app in `frontend/` named **Hedge in a Box**.

### What it reads
- `outputs/**/<TICKER>_dashboard.json` (preferred)
- fallback artifact routes for:
  - `<TICKER>_analysis.pdf`
  - `<TICKER>_prices_explain.txt`
  - `<TICKER>_prices_explain.pdf`
  - `<TICKER>_analysis.txt`

The full valuation runner now attempts to generate:
- `outputs/<TICKER>/<TICKER>_dashboard.json`

This JSON includes:
- command-center stats
- executive summary + key insights + bull/red flags + SWOT (LLM dashboard extraction)
- valuation block cards and key numeric means
- consensus/LMIL/CV metrics
- dream team cards
- forensic/forecast matrix fields

### Run locally
```powershell
cd frontend
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open:
- Dashboard: `http://127.0.0.1:3000`
- Discovery: `http://127.0.0.1:3000/discovery`

## Easy Fly Deploy

Use these scripts from project root:

```powershell
.\deploy-site.ps1
```

Windows cmd equivalents:

```cmd
deploy-site.cmd
```

Unified helper (all actions):

```powershell
.\deploy_fly.ps1 site
.\deploy_fly.ps1 status-site
.\deploy_fly.ps1 logs-site
```

Optional flags:

- `-NoDepot` adds `--depot=false`
- `-NoRemote` omits `--remote-only`

## Easy Git Push

Use these scripts from project root:

```powershell
.\push-git.ps1 -Message "feat: update dashboard"
```

Windows cmd:

```cmd
push-git.cmd feat: update dashboard
```

What it does:
- `git add -A`
- `git commit -m "<message>"` (only if there are changes)
- `git push` (or `git push -u origin <current-branch>` if upstream is missing)

## GitHub Auto Deploy (Fly)

This repo includes `.github/workflows/deploy-fly.yml` for automatic deploys on push to:
- `main`
- `master`

It deploys the site app:
- `hedge-in-a-box-site` using `fly.site.toml`

Required GitHub secret:
- `FLY_API_TOKEN` (Fly API token with access to the site app)
