# Nasdaq 100 workspace operations

The Nasdaq 100 workspace is release-based. Portfolio tracking starts only after
the active release cohort covers the complete issuer-deduplicated universe.
`Missing this week` runs may satisfy that cohort with reports saved by an older
active release during the same seven-day window; this avoids rerunning a fresh
analysis merely to move it into a newer release. Existing reports remain in the
Analysis workspace.

Create a staged release:

```powershell
python scripts/report_release.py create --key 2026-09
```

Generate each report into that release with the regular single-ticker CLI:

```powershell
python -m ai_hedge.cli --ticker AAPL --workspace nasdaq100 --release-id <release-uuid>
```

For a manually staged release, activate it after the operator has performed the
external coverage checks:

```powershell
python scripts/report_release.py activate --release <release-uuid-or-key>
```

Universe runs activate themselves. If a completed `Missing this week` run
spans several active releases, reconcile the release-cohort coverage gate:

```powershell
python scripts/report_release.py reconcile --release <release-uuid-or-key>
```

The command refuses to mark coverage complete unless every constituent group
in the run's frozen universe snapshot has a saved report in the current release
or another active release from the preceding seven days.

The scheduled Portfolio Performance workflow refreshes both Analysis and
Nasdaq 100. Nasdaq refreshes exit cleanly while there is no active release;
after the first complete cohort they begin collecting Paper and Backtest NAV,
QQQ benchmark history, and the `^IRX` 13-week Treasury yield used by Sharpe.
The same tracks can also be refreshed manually:

```powershell
Set-Location frontend
npm run portfolio:refresh -- --workspace nasdaq100 --track paper
npm run portfolio:refresh -- --workspace nasdaq100 --track backtest --start-cutoff 2026-04-30
```

The workflow-dispatch form accepts `all`, `analysis`, or `nasdaq100`. Risk
metrics are calculated from stored daily NAV rather than stored as mutable
summary values: annualized volatility and Sharpe become visible after at least
20 daily returns, with the observation count shown in the UI.

## Dedicated universe worker

Universe runs use a durable database queue. Each ticker attempt is claimed with
a renewable lease, so a crashed worker can be replaced without running the
same ticker twice. The current production setting is ten concurrent tickers,
an estimated $2 per attempt, up to three attempts per ticker, and a $600 hard
planned-cost limit. An individual attempt is terminated after two hours so a
hung provider call cannot hold the batch forever. Completed reports remain visible immediately; a stopped,
interrupted, budget-limited, or window-limited batch can be resumed for seven
days without repeating completed tickers.

The preferred execution window is stored in UTC: 10:00 through 01:00 the next
day. That maps to 13:00-04:00 during Israel daylight time and 12:00-03:00 during
standard time. Active tickers may finish after the boundary, but no new ticker
is dispatched. Peak/off-peak token accounting follows the
[official DeepSeek pricing schedule](https://api-docs.deepseek.com/quick_start/pricing/).

The worker is a separate scale-to-zero Fly app because the public site machine
must remain responsive. The production workflow creates the app, stages its
secrets, deploys it, and connects the site automatically once these GitHub
Actions secrets exist:

`NASDAQ_WORKER_TOKEN`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL`. Existing
`DEEPSEEK_API_KEY`, database, observability, and Fly secrets are reused. The R2
bucket needs a public/custom read domain for report artifacts; object keys
include release and timestamp identifiers, and directory listing must remain
disabled.

To provision or repair only the worker without deploying the production site,
run the `Deploy to Fly` workflow manually with target `nasdaq-worker`. Normal
pushes to `main` and manual runs with target `all` retain the full deployment
behavior. The worker deployment verifies the configured S3 credentials against
the bucket with a temporary write/delete probe before updating the Fly app.

If `NASDAQ_WORKER_URL` is absent, the API preserves a one-worker local fallback
for development and emergency operation. Do not use that fallback for the full
universe on the 1-CPU/2-GB site machine.

Nasdaq portfolios use QQQ adjusted close as the selected total-return proxy.
The UI labels it `Invesco QQQ — total-return proxy`; it is not represented as
the official XNDX series.

Release atomicity prevents partial publication, but without a constituent
manifest it does not prove that every Nasdaq 100 company was analyzed. Coverage
validation and automated batch execution belong to the later automation phase.
