# Brand Colors Harness

Single source of truth for color in [Hedge in a Box](src/app/page.tsx) (the Next.js dashboard at [frontend/](.)).

This file applies to **both** Claude Code (via [`CLAUDE.md`](../CLAUDE.md)) and Codex (via [`AGENTS.md`](../AGENTS.md)). Every color decision in `frontend/` must comply with the rules below. If you can't comply, stop and ask before merging.

---

## TL;DR — the four hard rules

1. **No color literals in `.tsx` / `.ts`.** Hex, `rgb(`, `rgba(`, `hsl(`, `oklch(` are allowed only inside `.css` files. Components consume tokens via Tailwind utilities or `var(--token)`.
2. **Both modes, always.** Every visible style must work in light AND dark. No `dark:`-only utilities. No "I'll fix light mode later."
3. **Charts read tokens.** Recharts / D3 / canvas props must read CSS vars via [`useThemeTokens()`](src/lib/theme-tokens.ts), never literal hex.
4. **Disabled changes color, not just opacity.** `disabled:opacity-60` alone fails WCAG in light mode — pair it with `disabled:text-[color:var(--text-disabled)]`.

---

## How theming works here

- **Mode switch:** `<html data-theme="dark">` or `<html data-theme="light">`. Default is `dark`.
- **Persistence:** `localStorage["hib-theme"]` — read by [`ThemeInit`](src/components/theme-init.tsx), written by [`ThemeToggle`](src/components/theme-toggle.tsx).
- **Tokens:** CSS custom properties under `:root` (dark) and `html[data-theme="light"]` (light overrides) in [`globals.css`](src/app/globals.css). Tailwind 4 picks them up via `@theme inline`.
- **Outside CSS:** if you need a literal color string in JS (Recharts `stroke`, canvas `fillStyle`, an inline `style` that won't accept `var()` for some reason), use the [`useThemeTokens()`](src/lib/theme-tokens.ts) hook. It re-reads on every `data-theme` change via a `MutationObserver`.

---

## Token reference

All values defined in [`globals.css`](src/app/globals.css). WCAG AA targets: **4.5:1** for body text, **3:1** for large text and non-text UI (borders, icons, chart strokes). Light variants of saturated colors are darkened so colored text passes 4.5:1 on white.

### Surfaces

| Token | Dark | Light | Use for |
|---|---|---|---|
| `--surface` | `#050608` | `#f7fafc` | Page background |
| `--surface-elevated` | `#0b0f14` | `#ffffff` | Cards, modals, panels |
| `--surface-overlay` | `rgba(11,15,20,0.92)` | `rgba(255,255,255,0.96)` | Dropdowns, popovers, hover tooltips |

### Borders

| Token | Dark | Light | Use for |
|---|---|---|---|
| `--border-subtle` | `rgba(255,255,255,0.08)` | `rgba(15,23,42,0.10)` | Default panel and divider borders |
| `--border-strong` | `rgba(255,255,255,0.18)` | `rgba(15,23,42,0.22)` | Focus rings, active state outlines |

### Text

| Token | Dark | Light | Use for |
|---|---|---|---|
| `--text-primary` | `#f5f7fa` | `#111827` | Body, headings |
| `--text-secondary` | `#cbd5e1` | `#334155` | Subheadings, table headers |
| `--text-muted` | `#94a3b8` | `#475569` | Hints, captions, secondary metadata |
| `--text-disabled` | `#64748b` | `#94a3b8` | Disabled text (always paired with `opacity-60`) |
| `--text-on-accent` | `#04140d` | `#04140d` | Text on emerald-filled buttons |

### Accents and status

| Token | Dark | Light | Use for |
|---|---|---|---|
| `--accent` | `#10b981` | `#059669` | Primary CTA, brand emerald |
| `--accent-hover` | `#34d399` | `#047857` | CTA hover |
| `--success` | `#10b981` | `#047857` | Positive status |
| `--warning` | `#f59e0b` | `#b45309` | Cautions, current-price reference |
| `--info` | `#60a5fa` | `#1d4ed8` | Informational |
| `--danger` | `#ef4444` | `#b91c1c` | Errors, destructive actions |

### Recommendation signals

| Token | Dark | Light | Use for |
|---|---|---|---|
| `--signal-buy` | `#22c55e` | `#15803d` | Buy / Strong Buy |
| `--signal-strong` | `#22c55e` | `#166534` | Strong Buy emphasis |
| `--signal-hold` | `#9ca3af` | `#475569` | Hold |
| `--signal-sell` | `#ef4444` | `#b91c1c` | Sell |
| `--signal-underperform` | `#f97316` | `#c2410c` | Underperform |

### Charts

| Token | Dark | Light | Use for |
|---|---|---|---|
| `--chart-grid` | `#29303a` | `#e2e8f0` | Recharts CartesianGrid stroke |
| `--chart-axis` | `#94a3b8` | `#475569` | Axis tick / label fill |
| `--chart-bull` | `#22c55e` | `#15803d` | Positive bars (above current) |
| `--chart-bear` | `#ef4444` | `#b91c1c` | Negative bars (below current) |
| `--chart-current` | `#f59e0b` | `#b45309` | Current-price reference line |
| `--chart-series-1..6` | emerald, blue, amber, fuchsia, mint, orange | darkened equivalents | Multi-series lines / bars |

### Persona accents (Dream Team)

Used by [`persona-themes.ts`](src/components/dream-team/persona-themes.ts). Each persona has `*-accent` (text-safe) and `*-accent-soft` (rgba 0.18, decorative).

| Persona | Var prefix | Dark accent | Light accent |
|---|---|---|---|
| Warren Buffett | `--persona-buffett-*` | `#fbbf24` | `#b45309` |
| Aswath Damodaran | `--persona-damodaran-*` | `#60a5fa` | `#1d4ed8` |
| Bill Ackman | `--persona-ackman-*` | `#fb923c` | `#c2410c` |
| Cathie Wood | `--persona-wood-*` | `#e879f9` | `#a21caf` |
| Charlie Munger | `--persona-munger-*` | `#f59e0b` | `#b45309` |
| Peter Lynch | `--persona-lynch-*` | `#22d3ee` | `#0e7490` |
| Howard Marks | `--persona-marks-*` | `#5eead4` | `#0f766e` |
| Peter Thiel | `--persona-thiel-*` | `#a78bfa` | `#6d28d9` |
| Ray Dalio | `--persona-dalio-*` | `#38bdf8` | `#0369a1` |
| Stanley Druckenmiller | `--persona-druckenmiller-*` | `#fb7185` | `#be123c` |
| (fallback) | `--persona-fallback-*` | `#34d399` | `#047857` |

`persona-themes.ts` returns these as `var(...)` strings, so consumers don't need a hook — theme switching updates colors automatically.

---

## Rules

### 1. No color literals in `.tsx` / `.ts`

Hex, `rgb(`, `rgba(`, `hsl(`, `oklch(` belong only in `.css` files where tokens are defined.

```tsx
// Bad — hardcoded hex; will not flip with theme
<div style={{ color: "#10b981" }}>...</div>
<Bar fill="#22c55e" />

// Good — token via Tailwind utility
<div className="text-[color:var(--accent)]">...</div>
// Good — token via the hook (Recharts can't interpolate var() in props)
const { "--chart-bull": bull } = useThemeTokens(["--chart-bull"]);
<Bar fill={bull} />
```

### 2. Both modes, always

Every visible color must work in light AND dark. Never write `dark:text-zinc-100` without a paired light value. If a token doesn't exist, add it (see "Adding a new color" below) — don't silently inline a hex.

```tsx
// Bad — dark-only Tailwind variant, breaks in light mode
<p className="dark:text-zinc-100">...</p>

// Good — semantic token works in both
<p className="text-[color:var(--text-primary)]">...</p>
```

### 3. Charts read tokens

Recharts / D3 / canvas APIs that take literal color strings must read tokens via [`useThemeTokens()`](src/lib/theme-tokens.ts). Reference implementation: [`target-price-chart.tsx`](src/components/target-price-chart.tsx).

```tsx
import { useThemeTokens } from "@/lib/theme-tokens";

const CHART_TOKENS = ["--chart-grid", "--chart-current", "--chart-bull", "--chart-bear"] as const;

export function MyChart() {
  const tokens = useThemeTokens(CHART_TOKENS);
  return (
    <BarChart>
      <CartesianGrid stroke={tokens["--chart-grid"]} />
      <ReferenceLine stroke={tokens["--chart-current"]} />
      <Cell fill={positive ? tokens["--chart-bull"] : tokens["--chart-bear"]} />
    </BarChart>
  );
}
```

### 4. Disabled changes color, not just opacity

`opacity-60` on its own keeps the foreground hue, which can still pass contrast in dark mode while failing in light. Pair it with a token-backed color shift.

```tsx
// Bad — light mode reads as low-contrast colored text
<button className="bg-emerald-500 text-emerald-100 disabled:opacity-60">Run</button>

// Good — color and opacity together
<button className="bg-emerald-500 text-emerald-100 disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60">Run</button>
```

### 5. Add token first, reference second

Introducing a new color is a two-step mental process:

1. Edit [`globals.css`](src/app/globals.css) — add the new var to **both** `:root` and `html[data-theme="light"]`. Verify contrast.
2. Edit this file — add a row to the relevant table.
3. Use `var(--your-token)` from your component.

Don't skip step 1 or 2.

### 6. Verify contrast

- Chrome DevTools → inspect element → "Accessibility" panel → "Contrast" checker.
- Manual checklist whenever you touch a color or theme-sensitive component:
  - Toggle theme via the sun icon.
  - Open the [`NewRunModal`](src/components/shell/new-run-modal.tsx) — confirm the muted hint and disabled buttons stay legible.
  - Open a ticker run and view the [`TargetPriceChart`](src/components/target-price-chart.tsx) — grid, axis labels, bull/bear bars, current-price reference line all visible in both modes.
  - Open a persona-themed area in the Dream Team gallery — accent reads in both modes.
  - Hover dropdowns / tooltips / popovers.
- Targets: **4.5:1** body text, **3:1** large text and non-text UI.

### 7. Allowed alpha utilities are mapped

These Tailwind alpha utilities have explicit light-mode overrides in `globals.css` and are safe to use:

- `bg-zinc-950/{70,80,95}`
- `bg-black/{20,25,30,35,40}`
- `bg-white/5`
- `border-white/{10,15,20}`
- `bg-red-500/{8,10}`, `border-red-500/{25,30,35,50}`

Other alpha values may not have a light override and will look broken. If you need a new one, add the override in `globals.css` (see how the existing ones are structured around lines 200–270).

### 8. Future: lint hook (not required now)

A Stylelint `color-no-hex` rule scoped to non-`globals.css` files (and an ESLint regex on JSX `style=` attrs) would mechanically enforce rule 1. We haven't added them yet — for now the harness is self-enforced via review. Don't ship a token-violating PR claiming "lint didn't catch it."

---

## Adding a new color

1. **Pick a semantic name.** What it means, not what it looks like — `--info-bg`, not `--blue-pale`.
2. **Add it to [`globals.css`](src/app/globals.css):**
   - Append a line under `:root` for the dark value.
   - Append a matching line under `html[data-theme="light"]` for the light value.
   - If it's a Tailwind-utility-friendly color, also map it inside the `@theme inline` block (`--color-foo: var(--foo);`).
3. **Verify contrast** against the surface it lives on, in both modes. WCAG AA: 4.5:1 body, 3:1 large/UI.
4. **Document it** — add a row to the relevant table in this file.
5. **Use it** as `var(--your-token)` or the Tailwind utility, never as a literal.

---

## Known debt and exceptions

These are pre-existing patterns the harness inherited. They're allowed for now but flagged as **next migration targets** — when you touch one of these areas, take it with you.

- **Per-utility light overrides in [`globals.css`](src/app/globals.css) (lines 63–193).** ~50 selectors like `html[data-theme="light"] .text-zinc-300 { color: #334155 !important; }` back legacy `text-zinc-*` / `bg-zinc-950/*` / `border-white/N` usage in components not yet migrated. Don't add new ones — add a token instead. Existing usage stays until the touching component migrates.
- **Component-scoped `.hib-*` classes (lines 200–820).** Used for legacy semantic styling (sidebar, topbar, signal tones, charts). Already theme-aware. New components should prefer tokens directly; only add new `.hib-*` classes when you genuinely need a multi-property pseudo-component.
- **`hib-google-btn` keeps a hardcoded `#ffffff` background.** It's a brand-mandated Google sign-in button; do not theme it.

---

## Changelog

- **2026-04-26** — initial harness. Expanded `:root` from 7 tokens to ~30, added full light token block, added per-persona vars, refactored [`target-price-chart.tsx`](src/components/target-price-chart.tsx) and [`persona-themes.ts`](src/components/dream-team/persona-themes.ts) and [`new-run-modal.tsx`](src/components/shell/new-run-modal.tsx) to comply.
