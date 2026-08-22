# Interactive Brokers Paper trading operations

## Runtime architecture

The production site is the control plane. Portfolio Refresh records immutable
Paper snapshots, a separate eligibility record, and at most one rebalance plan
for each linked strategy and snapshot. Neon stores user ownership, masked broker
identity, device-secret hashes, commands, fills, alerts, and audit events.

The Windows VM is the execution plane. IB Gateway listens only on
`127.0.0.1:4002`; the executor makes outbound HTTPS requests to the site. Pairing
returns a device secret exactly once. Subsequent request bodies use HMAC-SHA256
with a five-minute timestamp window and a one-use nonce. IBKR login and 2FA stay
inside IB Gateway.

Live is intentionally unavailable in this release. `IBKR_LIVE_TRADING_ENABLED`
remains off and the executor itself rejects Live mode and port `4001`.

## Production secrets

Set these only on the production Fly app and, for the monitor token, as the
matching GitHub Actions repository secret:

- `TRADING_ACCOUNT_FINGERPRINT_KEY`: random secret used to identify the paired
  account without storing its number. Existing `AUTH_SECRET` is a fallback, but
  a dedicated key is preferred.
- `TRADING_MONITOR_TOKEN`: random bearer token for the scheduled heartbeat
  monitor.
- `TRADING_TELEGRAM_BOT_TOKEN` and `TRADING_TELEGRAM_CHAT_ID`: trading alert
  destination.

Preview environments deliberately receive none of these. Even though the
Trading page and branched demo data are visible, `AUTH_BYPASS_PREVIEW=1` forces
all mutations and executor endpoints to return disabled.

## Snapshot and execution lifecycle

1. The existing daily Portfolio Refresh updates NAV. It creates a new Paper
   snapshot of up to 20 positive-score names only for the monthly cutoff policy;
   fewer names are a valid methodology result.
2. The refresh writes eligibility separately so the frozen snapshot and
   holdings are never rewritten. Backtests, Analysis, empty targets, and any run
   with provider warnings are ineligible.
3. For an armed Nasdaq-100 strategy, a unique plan is enqueued for the new
   snapshot. Re-running the refresh cannot create a duplicate plan.
4. The executor reconciles the account, positions, open orders, and individual
   `ExecId` fills, reports recovered broker state, and only then pulls commands.
   It acquires a single-writer server lease before connecting to Gateway and
   acts only Monday-Friday between 10:00 and 15:30 New York time. A per-connection
   SQLite WAL journal preserves order intents, executions, and outbound events
   across a process or control-plane restart.
5. It resolves unique USD stock contracts, fetches fresh NBBO, checks manual
   positions/open orders and settled cash, and sizes at 98% of the lesser of
   the fixed budget or strategy equity. Every one of
   the snapshot's N targets must receive a tradable quantity (`N/N`), regardless
   of whether N is 20 or smaller; otherwise the complete plan is blocked.
6. Every real attempt passes WhatIf and a retry may never worsen the preflight
   limit. Sells execute first. Buys start only
   after every sell completes and IBKR reports enough settled USD cash. Sale
   proceeds from the same day and margin buying power are not counted. The
   correction-aware strategy cash ledger also prevents unrelated account cash
   from refilling losses. A plan can wait until a later session in
   `awaiting_settlement`.
7. Paper research performance remains on Portfolio Returns. Actual orders,
   fills, fees, lag, and strategy-owned quantities remain on Trading.

## Activation checklist

- Apply migrations `011_ibkr_paper_trading.sql` and
  `012_ibkr_trading_hardening.sql` and `013_ibkr_executor_durability.sql`, then
  confirm every new table, status, lease, cash-ledger, and correction field exists.
- Configure production secrets and confirm the monitor workflow receives HTTP
  200.
- Use a dedicated IBKR Paper username where account policy permits it.
- Pair the VM, verify heartbeat, and first run with local execution disabled.
- Verify a second local process and a second executor instance are rejected,
  then verify Pause/kill switch cancels only system orders.
- Verify contract resolution, fresh NBBO, and full `N/N` coverage for every
  target symbol in the selected snapshot.
- Verify WhatIf and a low-budget Paper order cycle with Telegram alerts.
- Complete one full monthly Paper rebalance, including sells, buys, a forced
  partial/retry, duplicate execution callback, and executor restart.
- Do not design or enable a Live connection record until that full gate has
  passed. Paper is never converted into Live; Live will require a new pairing
  and a separate explicit UI confirmation.
