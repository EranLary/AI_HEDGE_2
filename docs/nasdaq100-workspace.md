# Nasdaq 100 workspace operations

The Nasdaq 100 workspace is release-based. It intentionally has no scheduler,
batch runner, or constituent manifest yet. Existing reports remain in the
Analysis workspace.

Create a staged release:

```powershell
python scripts/report_release.py create --key 2026-09
```

Generate each report into that release with the regular single-ticker CLI:

```powershell
python -m ai_hedge.cli --ticker AAPL --workspace nasdaq100 --release-id <release-uuid>
```

Staged reports are not visible through the site or public APIs. After the
operator has performed the external coverage checks, activate the complete
release atomically:

```powershell
python scripts/report_release.py activate --release <release-uuid-or-key>
```

Then refresh the Nasdaq portfolio tracks manually:

```powershell
Set-Location frontend
npm run portfolio:refresh -- --workspace nasdaq100 --track paper
npm run portfolio:refresh -- --workspace nasdaq100 --track backtest --start-cutoff 2026-04-30
```

Nasdaq portfolios use QQQ adjusted close as the selected total-return proxy.
The UI labels it `Invesco QQQ — total-return proxy`; it is not represented as
the official XNDX series.

Release atomicity prevents partial publication, but without a constituent
manifest it does not prove that every Nasdaq 100 company was analyzed. Coverage
validation and automated batch execution belong to the later automation phase.
