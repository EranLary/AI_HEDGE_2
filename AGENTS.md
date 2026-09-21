# AGENTS.md

Guidance for AI coding agents (Codex, etc.) working in this repo.

[CLAUDE.md](CLAUDE.md) is the canonical onboarding doc — repo layout, env, run/deploy commands, and the "Don't" list all live there. Read it first.

This file mirrors the most important cross-cutting rules so Codex doesn't have to chase indirections.

For the current runtime order and persistence boundaries, also read
[docs/architecture/system-map.md](docs/architecture/system-map.md),
[docs/architecture/pipeline.md](docs/architecture/pipeline.md) and
[docs/architecture/data-lifecycle.md](docs/architecture/data-lifecycle.md).

## Current system boundaries

- `src/ai_hedge/` is the shared analysis core used by the CLI, site-triggered
  runs, and the release-scoped Nasdaq worker.
- `frontend/` is both the customer-facing site and the server-side control plane
  for reports, portfolios, Nasdaq orchestration, and Paper trading.
- `frontend-obs/` is a separate internal app backed by the observability database.
- `trading_executor/` is the local Windows IBKR Paper agent and the only component
  allowed to contact IB Gateway; broker credentials must never move to the site.
- There is no active Telegram bot runtime. Telegram is used only for trading
  alerts sent by the site.

## Task mode and existing work

- For a read-only audit or diagnosis, do not switch branches, pull, migrate, clean,
  delete, or rewrite files unless the user separately authorizes a change.
- Before any authorized code or documentation change, inspect the branch and
  working tree. Treat every existing tracked or untracked change as user-owned.
- The clean-`main` branch workflow below applies when starting a new change, not
  when merely inspecting the repository.

## Workflow: PR-first, never push to main

**Never commit or push directly to `main` / `master`.** Every change goes through a pull request — no exceptions unless the user explicitly authorizes a direct push (e.g. recovering a broken `main`).

A merge to `main` triggers a prod deploy. Direct pushes bypass review and the per-PR preview environment, both of which exist precisely to keep prod safe. The PR is the unit of work; treat the branch as scratch.

Concrete flow when starting work:

```bash
git checkout main && git pull
git checkout -b <type>/<short-desc>   # feat/, fix/, chore/, refactor/, test/
# ...edit, commit...
git push -u origin <branch>
gh pr create --title "..." --body "..."   # use .github/pull_request_template.md
```

Then:

- Changes under **`frontend/**`, `src/**`, `requirements.txt`, `Dockerfile.site`,
  or `fly.site.toml`** trigger the site preview workflow
  ([.github/workflows/preview-site.yml](.github/workflows/preview-site.yml)). It
  auto-deploys `pr-<N>-hedge-in-a-box-site.fly.dev` and posts the URL in a
  sticky comment. **Open the URL and verify the affected route/API** before
  declaring the task done; report what you verified in the PR body.
- Changes outside those paths may not receive a preview. Always verify locally
  and document the exact commands in the PR's "Test plan" section.

**Start every task from a clean `main`.** Before making any code change, check where you are: `git branch --show-current` and `git status`. If you're on a feature branch left over from a previous task, **do not pile new work onto it** — that branch belongs to a different PR and mixing changes will pollute its diff and confuse review. Switch to `main`, pull, and branch off:

```bash
git checkout main && git pull && git checkout -b <type>/<short-desc>
```

The only exception is when the user explicitly asks you to amend or extend a specific existing PR (e.g. "address review comments on #42") — in that case, check out that PR's branch and continue.

If you find yourself on `main` with uncommitted changes, **stop and switch to a feature branch before committing**. Don't push.

## Data and persistence

- Neon Postgres is the site source of truth for saved reports, report metadata,
  releases, portfolio history, and trading state. `outputs/` is the local/runtime
  working tree and a compatibility fallback; do not infer current site state from
  files alone.
- R2 stores immutable run artifacts for workers that do not share the site Fly
  volume. `report_artifacts.r2_keys` contains pointers; the report row and its
  structured/text sources remain the authoritative catalog.
- Site-run status is transitional dual-write: `site_runs` is preferred for shared
  status fields, while `_status.json` supplies process-local fields and terminal
  fallback. Changes must preserve both paths until that migration is completed.
- Analysis reports require `workspace='analysis'` and no `release_id`; Nasdaq
  reports require `workspace='nasdaq100'` and a matching release. Audit every
  loader and aggregate when changing this boundary.
- Paper portfolio snapshots and holdings are immutable. Never update or delete
  Paper history as part of a repair; insert only missing snapshots.
- Change schema only through a new numbered migration. Never edit an applied
  migration. Run `python scripts/db/migrate.py --dry-run` before proposing a DB
  change, and never run `python scripts/db/cli.py init --reset` without explicit
  user approval.

## Cross-layer contracts

- A dashboard payload change must be traced through the Python builder,
  `src/ai_hedge/db/transform.py`, the persisted report fields, frontend types and
  normalization, and every affected Analysis/Nasdaq route.
- An artifact change must update creation, optional R2 upload, DB pointers, route
  resolution, and legacy fallback behavior together.
- Keep task scratch under `.tmp/<task>/`. Do not create new root-level
  `.codex-pytest-*`, `.pytest-tmp*`, snapshot, or ad-hoc output directories.
- Use [scripts/verify.cmd](scripts/verify.cmd) for the documented validation
  scopes; the underlying commands are listed in
  [docs/development/testing.md](docs/development/testing.md).

## Frontend theming

The Next.js app at [frontend/](frontend/) supports light + dark via `html[data-theme]`. Color tokens, contrast rules, and the do/don't list live in [frontend/BRAND_COLORS.md](frontend/BRAND_COLORS.md). **Read it before adding any color, chart, or theme-sensitive component.**

Hard rules (full version in `BRAND_COLORS.md`):

1. No color literals (`#hex`, `rgb()`, `rgba()`, `hsl()`) in `.tsx` / `.ts`. Add a token to [frontend/src/app/globals.css](frontend/src/app/globals.css) first, then reference via `var(--token)` or a Tailwind utility.
2. Every visible style must work in BOTH light and dark mode. No `dark:`-only utilities.
3. Charts (Recharts / D3 / canvas) must read tokens via [`useThemeTokens()`](frontend/src/lib/theme-tokens.ts). Reference: [target-price-chart.tsx](frontend/src/components/target-price-chart.tsx).
4. Disabled states must change color (`disabled:text-[color:var(--text-disabled)]`), not just opacity.

When in doubt: open `BRAND_COLORS.md`, find the token, use it.

## Don't

These come from [CLAUDE.md](CLAUDE.md) and apply equally here:

- Don't bump Python to 3.13+ without checking `weasyprint` / `python-pptx` wheels.
- Don't run `pip install` in the Docker image's build context expecting to persist `outputs/` — the Fly container symlinks `/app/outputs` → `/data/outputs` at startup.
- Don't casually refactor [src/ai_hedge/legacy_port.py](src/ai_hedge/legacy_port.py) prompts/parsers — they mirror notebook behavior.
- Don't commit generated artifacts under `outputs/`, `logs/`, or `.env`.

## Where to look

- Architecture, env, deployment: [CLAUDE.md](CLAUDE.md).
- System topology: [docs/architecture/system-map.md](docs/architecture/system-map.md).
- Runtime order: [docs/architecture/pipeline.md](docs/architecture/pipeline.md).
- Persistence and source-of-truth rules: [docs/architecture/data-lifecycle.md](docs/architecture/data-lifecycle.md).
- Documentation index: [docs/README.md](docs/README.md).
- Validation commands: [docs/development/testing.md](docs/development/testing.md).
- Frontend colors / theming: [frontend/BRAND_COLORS.md](frontend/BRAND_COLORS.md).
- Backend dependency map: [docs/architecture/dependency-map.md](docs/architecture/dependency-map.md).
