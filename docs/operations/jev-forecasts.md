# Jev forecasts

Jev reads the persisted Analysis and Valuation Markdown after a report is saved
and returns seven boolean probabilities: 1 week, 1 month, 3 months, 6 months,
1 year, 3 years, and 5 years. The site converts each probability into YES/NO at
the 50% threshold while retaining the original probability for calibration.

## Configuration

Set `AI_GATEWAY_API_KEY` locally, as a GitHub Actions repository secret, and on
both Fly applications that can execute analysis:

- `hedge-in-a-box-site`
- `hedge-in-a-box-nasdaq-worker`

Every request sets Vercel's `disallowPromptTraining` option. Set
`JEV_ZERO_DATA_RETENTION=1` only after the Vercel team supports request-level
ZDR; unsupported plans reject those requests.

## Methodology

- The report publication timestamp is omitted and its exact textual forms are
  redacted from the model input. Fiscal-period dates remain because they are
  material research evidence.
- Inputs below 80,000 characters use the complete persisted Analysis and
  Valuation Markdown. Longer inputs preserve the beginning and valuation tail
  with an explicit deterministic omission marker.
- New-run forecasts are labeled `forward`. Historical backfills are labeled
  `retrospective` and are never silently mixed into forward track-record data.
- Outcomes use split-adjusted daily closes. The baseline is the first available
  close on or after report availability; the outcome is the first available
  close on or after the calendar target date.
- Hit rate measures the YES/NO direction. Brier score measures probability
  quality. Calibration compares mean predicted probability with observed up
  frequency in five fixed buckets.

## Backfill

Apply migration `018_report_jev_forecasts.sql`, then inspect candidates without
calling the provider:

```powershell
python scripts/db/backfill_jev_forecasts.py --workspace all --limit 25 --dry-run
```

Run a bounded batch:

```powershell
python scripts/db/backfill_jev_forecasts.py --workspace all --limit 25
```

Repeat until the candidate count is zero. Failed rows are retained with their
error and can be retried explicitly with `--retry-failed`.

## Outcome refresh

The `Jev outcomes` GitHub Actions workflow runs Tuesday through Saturday and
resolves every matured pending horizon. It can also be run locally:

```powershell
python scripts/db/refresh_jev_outcomes.py --workspace all --dry-run
python scripts/db/refresh_jev_outcomes.py --workspace all
```
