# Jev forecasts

Jev reads a deterministic evidence pack from the persisted Analysis Markdown
after a report is saved and returns seven boolean probabilities: 1 week, 1 month, 3 months, 6 months,
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
- The evidence pack contains complete copies of these Analysis sections when
  present: company description, general information, news, all-reports insight,
  analyst expectations, Bull vs Bear, Dashboard Extraction Pack, Wall Street,
  Technical Analysis, and Financials. It never includes `prices_explain_md` or
  other valuation sections.
- Some historical Analysis artifacts contain an exact embedded copy of their
  separate Prices Explain artifact. That legacy copy is removed before section
  extraction.
- The pack has a production-measured 31,000-character ceiling. If a report
  exceeds it, Wall Street, general information, Technical Analysis, analyst
  expectations, and Financials are removed in that order as complete sections.
  The company description, news, all-reports insight, Bull vs Bear, and
  Dashboard Extraction Pack remain the required core and are never cut
  mid-text. A 597-report audit produced a median 26,234-character final pack,
  p95 of 30,695, and maximum of 30,971 with no errors. This lower ceiling
  reflects the production backfill, where provider 503/429 rates rose sharply
  above roughly 30,000 characters despite the larger advertised token window.
- New-run forecasts are labeled `forward`. Historical backfills are labeled
  `retrospective` and are never silently mixed into forward track-record data.
- Outcomes use split-adjusted daily closes. The baseline is the first available
  close on or after report availability; the outcome is the first available
  close on or after the calendar target date.
- Hit rate measures the YES/NO direction. The track record defaults to
  `Positive only`, which includes only YES calls (`probability_up >= 50%`), and
  can be switched to all calls. Brier score measures probability quality.
  Calibration groups resolved calls into probability ranges, then compares the
  mean predicted probability with the actual share that rose. The displayed N
  is the bucket sample size and the calibration error is the sample-weighted
  average absolute gap across populated buckets.
- The report-level Jev tab shows the seven answers for that report. The main
  Track Record page also shows workspace-wide Jev hit rate, Brier score,
  calibration buckets, horizon detail, and a cumulative timeline keyed to the
  dates on which outcomes matured. Forward and retrospective tracks remain
  separate on both surfaces.

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
