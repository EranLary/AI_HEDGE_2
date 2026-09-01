# HTML-first reports

The site exposes three report documents for every full analysis: Analysis,
Valuation, and Combined. Each document is rendered from the source already
stored in `report_artifacts`, so no standalone HTML file is persisted.

- HTML is the primary human-readable view and includes navigation, responsive
  layout, light/dark themes, tables, and print styling.
- Markdown is the smallest, cleanest export for external language models.
- PDF is rendered from the same HTML only after an explicit download request.
  The API returns `Cache-Control: private, no-store` and streams the generated
  bytes without writing them to `outputs`, R2, or the database.

Valuation and Combined reports add a clearly separated TradingAgents tactical
section from the completed dashboard payload. It can show the stored committee
stance, rating, tactical target, and time horizon, but it is composed only at
download/view time and never crosses back into an AI Hedge valuation prompt.
Analysis reports intentionally omit this tactical section.

Famous-investor valuation outputs are labeled `AI PERSONA` in HTML, Markdown,
and PDF, with a disclosure that these are synthetic perspectives rather than
statements from or endorsements by the named people.

Historical reports use `prices_explain_md` when it exists. Older reports that
predate that field are rendered from their original structured
`dashboard.valuation_hub.prices` values, with a visible disclosure. The fallback
does not invent missing narrative.

## Legacy PDF cleanup

`scripts/cleanup_report_pdfs.py` is audit-only by default. It refuses deletion
if any active report lacks both its analysis source and a recoverable valuation
source. It targets only the legacy full-report kinds:

- `analysis-pdf`
- `prices-explain-pdf`
- `combined-pdf`

Run the audit after the HTML-first site version is deployed:

```powershell
python scripts/cleanup_report_pdfs.py
```

Production cleanup is intentionally a two-step operation. First remove R2
objects from the Nasdaq worker, which has the private R2 credentials and updates
`report_artifacts.r2_keys`:

```powershell
fly ssh console -a hedge-in-a-box-nasdaq-worker -C "python3 /app/scripts/cleanup_report_pdfs.py --delete --yes"
```

Then remove matching full-report PDFs from the site volume. The script only
classifies an `*_analysis.pdf` as a full report when its directory also contains
a dashboard or another member of the three-PDF set, so lite-analysis PDFs are
not included:

```powershell
fly ssh console -a hedge-in-a-box-site -C "python3 /app/scripts/cleanup_report_pdfs.py --outputs-root /data/outputs --delete --yes"
```

Re-run the audit after both commands. A completed cleanup reports zero R2 PDF
objects, zero local full-report PDF files, and zero unrecoverable reports.
