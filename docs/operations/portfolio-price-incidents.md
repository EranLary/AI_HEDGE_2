# Portfolio price incidents

The scheduled portfolio refresh records missing prices that affect a selected
candidate or an active holding. A repeated run on the same date does not count
twice.

- First and second missing observations: monitor the symbol.
- Third missing observation: quarantine it from new portfolio purchases.
- Existing holdings are valued at their last usable value and marked stale;
  missing data alone never invents a sale.
- A quarantined symbol needs three successful observations to recover
  automatically. A one-off monitored gap resolves after the next success.

The customer UI keeps using the compact Track Record health warning. Incident
details and the audit trail are operator-only:

```powershell
cd frontend
npm run portfolio:incidents -- list
npm run portfolio:incidents -- show <incident-id>
```

Administrative mutations are dry-run by default. Correct the underlying market
data or verified corporate-action handling first, then resolve and replay the
derived NAV in one command:

```powershell
npm run portfolio:incidents -- resolve <incident-id> `
  --kind provider_override `
  --effective-on 2026-09-22 `
  --note "Verified provider correction" `
  --replay --through 2026-09-22 --apply
```

The replay covers every affected track and methodology recorded on the
incident. It recomputes mutable derived NAV rows; Paper snapshots and holdings
remain immutable. If the price is still missing, the refresh opens the incident
again instead of pretending the repair succeeded.

Use `--kind irrelevant` only when the symbol provably does not affect a real
candidate or holding. To undo an incorrect decision:

```powershell
npm run portfolio:incidents -- reopen <incident-id> `
  --effective-on 2026-09-22 --note "Decision reversed" --apply
```

Set `PORTFOLIO_INCIDENT_ACTOR` before a mutation when the default local username
is not a useful audit identity.
