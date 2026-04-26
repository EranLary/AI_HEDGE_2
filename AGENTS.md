# AGENTS.md

Guidance for AI coding agents (Codex, etc.) working in this repo.

[CLAUDE.md](CLAUDE.md) is the canonical onboarding doc — repo layout, env, run/deploy commands, and the "Don't" list all live there. Read it first.

This file mirrors the most important cross-cutting rules so Codex doesn't have to chase indirections.

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
- Don't swap `python-telegram-bot` off the `[job-queue]` extra — `bot/telegram_bot.py` fails fast if the JobQueue isn't available.
- Don't run `pip install` in the Docker image's build context expecting to persist `outputs/` — the Fly container symlinks `/app/outputs` → `/data/outputs` at startup.
- Don't casually refactor [src/ai_hedge/legacy_port.py](src/ai_hedge/legacy_port.py) prompts/parsers — they mirror notebook behavior.
- Don't commit generated artifacts under `outputs/`, `logs/`, or `.env`.

## Where to look

- Architecture, env, deployment: [CLAUDE.md](CLAUDE.md).
- Frontend colors / theming: [frontend/BRAND_COLORS.md](frontend/BRAND_COLORS.md).
- Backend dependency map: [docs/dependency-map.md](docs/dependency-map.md).
