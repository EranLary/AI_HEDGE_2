# IBKR Paper executor

This process is the only component that talks to IB Gateway. It is designed for
a persistent Windows VM with an interactive Desktop/RDP session. The website
never receives the IBKR password, 2FA response, or full account number.

## Install

1. Install IB Gateway and the matching TWS API package from IBKR.
2. In the extracted TWS API package, install its official Python client into a
   dedicated virtual environment:

   ```powershell
   py -3.12 -m venv .venv-ibkr
   .\.venv-ibkr\Scripts\python.exe -m pip install -r trading_executor\requirements.txt
   .\.venv-ibkr\Scripts\python.exe -m pip install C:\TWSAPI\source\pythonclient
   ```

   Do not install an old, independently published `ibapi` build from PyPI. The
   client and Gateway versions must match.

3. Configure IB Gateway for Paper trading:

   - socket port `4002`;
   - API connections enabled;
   - Read-Only API disabled only when Paper orders are ready to be tested;
   - localhost/trusted IP `127.0.0.1` only;
   - automatic weekday restart enabled.

4. In the site Trading tab, create a one-time pairing code. On the VM:

   ```powershell
   .\.venv-ibkr\Scripts\python.exe -m trading_executor pair `
     --code ABCD-EFGH `
     --account DU1234567
   ```

   The device secret and account number are encrypted with Windows DPAPI for
   the current Windows user under `%LOCALAPPDATA%\HedgeInABox`.

5. Start in reconciliation-only mode. No order is sent unless the local gate is
   explicitly enabled:

   ```powershell
   .\.venv-ibkr\Scripts\python.exe -m trading_executor run
   ```

6. After contract, quote, WhatIf, ownership, and alert validation, set the local
   environment variable and restart:

   ```powershell
   [Environment]::SetEnvironmentVariable("IBKR_EXECUTION_ENABLED", "1", "User")
   ```

7. Install the at-logon scheduled task while logged in as the dedicated Windows
   user:

   ```powershell
   .\trading_executor\setup-task.ps1 -PythonExe "$PWD\.venv-ibkr\Scripts\python.exe"
   ```

IBKR still requires human authentication after its weekend reset. The executor
stops trading while the session is unavailable and the server-side monitor
sends a Telegram alert.

## Safety boundary

- This build hard-refuses Live mode, non-localhost Gateway hosts, and ports other
  than Paper port `4002`.
- Every command is reconciled against account positions, open orders, and
  executions before work starts.
- Manual overlap in a target or strategy-owned ticker blocks the whole plan.
- Empty targets never liquidate. Sells complete before buys. Quotes must contain
  a fresh bid and ask, and every order passes IBKR WhatIf before any real order.
- Orders are SMART, DAY, regular-hours-only, marketable limits. Unfilled orders
  are cancelled and repriced at most three times; remaining quantity becomes a
  partial plan for the next session.
- Order references are deterministic by plan, symbol, side, revision, and
  attempt. Server-side `PermId` and `ExecId` uniqueness protects callback replay.

Run the broker-independent tests with:

```powershell
python -m unittest discover -s trading_executor\tests -v
```
