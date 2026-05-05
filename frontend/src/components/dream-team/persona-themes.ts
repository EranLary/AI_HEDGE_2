/*
 * Persona accents resolve to CSS custom properties (see :root and
 * html[data-theme="light"] in frontend/src/app/globals.css). The returned
 * strings are var(...) references, so theme changes update colors automatically
 * without needing a hook in every consumer.
 */

export type PersonaTheme = {
  role: string;
  tagline: string;
  accent: string;
  accentSoft: string;
};

export const INVESTORS_ORDERED = [
  "Warren Buffett",
  "Aswath Damodaran",
  "Charlie Munger",
  "Peter Lynch",
  "Peter Thiel",
  "Howard Marks",
  "Bill Ackman",
  "Cathie Wood",
  "Ray Dalio",
  "Stanley Druckenmiller",
] as const;

export const OVERVIEW_FEATURED_PERSONAS = [
  "Warren Buffett",
  "Cathie Wood",
  "Bill Ackman",
] as const;

const FALLBACK: PersonaTheme = {
  role: "AI Persona",
  tagline: "Synthetic perspective",
  accent: "var(--persona-fallback-accent)",
  accentSoft: "var(--persona-fallback-accent-soft)",
};

const THEMES: Record<string, PersonaTheme> = {
  "Warren Buffett": {
    role: "Value Investor",
    tagline: "Owner-mindset, margin of safety, patient compounding.",
    accent: "var(--persona-buffett-accent)",
    accentSoft: "var(--persona-buffett-accent-soft)",
  },
  "Aswath Damodaran": {
    role: "Valuation Academic",
    tagline: "Story to numbers - disciplined DCF, intrinsic worth.",
    accent: "var(--persona-damodaran-accent)",
    accentSoft: "var(--persona-damodaran-accent-soft)",
  },
  "Bill Ackman": {
    role: "Activist Investor",
    tagline: "Concentrated, catalyst-driven, conviction at scale.",
    accent: "var(--persona-ackman-accent)",
    accentSoft: "var(--persona-ackman-accent-soft)",
  },
  "Cathie Wood": {
    role: "Innovation Bull",
    tagline: "Disruption, exponential curves, conviction in the new.",
    accent: "var(--persona-wood-accent)",
    accentSoft: "var(--persona-wood-accent-soft)",
  },
  "Charlie Munger": {
    role: "Mental Models",
    tagline: "Multidisciplinary filters, quality bias, and clear thinking.",
    accent: "var(--persona-munger-accent)",
    accentSoft: "var(--persona-munger-accent-soft)",
  },
  "Peter Lynch": {
    role: "Growth-at-Reasonable-Price",
    tagline: "Know what you own, scale winners, keep valuation discipline.",
    accent: "var(--persona-lynch-accent)",
    accentSoft: "var(--persona-lynch-accent-soft)",
  },
  "Peter Thiel": {
    role: "Contrarian Strategist",
    tagline: "Look for secrets, asymmetric bets, and monopoly-scale upside.",
    accent: "var(--persona-thiel-accent)",
    accentSoft: "var(--persona-thiel-accent-soft)",
  },
  "Howard Marks": {
    role: "Cycles & Risk",
    tagline: "Second-level thinking - what is priced, what is missed.",
    accent: "var(--persona-marks-accent)",
    accentSoft: "var(--persona-marks-accent-soft)",
  },
  "Ray Dalio": {
    role: "Macro & Regimes",
    tagline: "Balance through cycles, probabilities, and diversification.",
    accent: "var(--persona-dalio-accent)",
    accentSoft: "var(--persona-dalio-accent-soft)",
  },
  "Stanley Druckenmiller": {
    role: "Risk-Adjusted Conviction",
    tagline: "Aggressive when odds align, fast when thesis breaks.",
    accent: "var(--persona-druckenmiller-accent)",
    accentSoft: "var(--persona-druckenmiller-accent-soft)",
  },
};

export function getPersonaTheme(name: string | null | undefined): PersonaTheme {
  if (!name) return FALLBACK;
  return THEMES[name.trim()] || FALLBACK;
}

export function personaInitials(name: string | null | undefined): string {
  if (!name) return "AI";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "AI";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
