# frontend-obs

Internal observability admin app. Renders the LLM call DAG for every pipeline run and manages the obs admin allowlist. Deployed standalone as `hedge-in-a-box-obs` on Fly, behind `https://observability.hedge-in-a-box.com`.

This app is **not** the public site. Public marketing + valuation dashboard live in [`../frontend/`](../frontend/).

## Surface

| Route | What it does |
|---|---|
| `/` | Redirect to `/runs` |
| `/runs` | List recent obs runs (cost, tokens, duration, status) |
| `/runs/[runId]` | DAG view — stage nodes with click-to-expand calls + side panel for prompt/response/cost |
| `/users` | Manage admin allowlist (super admins can add/remove others; can't remove self) |
| `/auth/signin` | Google sign-in (only provider) |

## Auth model

- **Independent NextAuth from the public site.** Separate `AUTH_SECRET`, separate Google OAuth client, no shared cookie domain. A bug in the public site's auth surface cannot leak admin access here.
- **Admin allowlist is in the database**, not an env var. Table: `obs_admins(email, added_by, added_at, is_super)`. Created by [`003_obs_admins.sql`](../src/ai_hedge/db/migrations/003_obs_admins.sql).
- **Super admins** can remove other supers; regular admins can only add new admins or remove themselves... actually the UI blocks self-removal too, so removal of regulars only.

## Local dev

```powershell
cd frontend-obs
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Local dev bypasses auth on `localhost`/`127.0.0.1` (gated by env `AUTH_BYPASS_LOCAL=1`, default on). For full Google sign-in testing locally, set `AUTH_BYPASS_LOCAL=0` and ensure `http://localhost:3001/api/auth/callback/google` is on the OAuth client's authorized redirect URIs.

`OBS_DATABASE_URL` is read from `frontend-obs/.env.local` (or falls back to `DATABASE_URL_UNPOOLED` / `DATABASE_URL`).

## Deploy

```powershell
.\deploy_fly.ps1 obs
```

GitHub Actions auto-deploys on push to `main`/`master` once the Fly app exists. CI's `deploy-obs` job in [.github/workflows/deploy-fly.yml](../.github/workflows/deploy-fly.yml) skips gracefully if the app hasn't been created yet.

First-time setup, DNS, and OAuth redirect URI requirements are documented in [CLAUDE.md](../CLAUDE.md) under "Observability app first-time setup".

## What does NOT live here

- **Pipeline writer** — instrumentation that captures LLM calls into `obs_runs` / `obs_calls` lives in [`../src/ai_hedge/obs/`](../src/ai_hedge/obs/). It runs in-process with the pipeline. Don't move it; it monkey-patches `legacy_port`.
- **User table** — `users(google_sub, email, ...)` is in the public site's main Neon DB. The obs app does not write to it; it only checks `obs_admins` for the authenticated email.
