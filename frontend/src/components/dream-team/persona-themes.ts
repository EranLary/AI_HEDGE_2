export type PersonaTheme = {
  role: string;
  tagline: string;
  accent: string;
  accentSoft: string;
  gradientFrom: string;
  gradientTo: string;
};

export const INVESTORS_ORDERED = [
  "Warren Buffett",
  "Aswath Damodaran",
  "Charlie Munger",
  "Peter Lynch",
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
  accent: "#34d399",
  accentSoft: "rgba(52, 211, 153, 0.18)",
  gradientFrom: "#064e3b",
  gradientTo: "#022c22",
};

const THEMES: Record<string, PersonaTheme> = {
  "Warren Buffett": {
    role: "Value Investor",
    tagline: "Owner-mindset, margin of safety, patient compounding.",
    accent: "#fbbf24",
    accentSoft: "rgba(251, 191, 36, 0.18)",
    gradientFrom: "#78350f",
    gradientTo: "#1c1917",
  },
  "Aswath Damodaran": {
    role: "Valuation Academic",
    tagline: "Story to numbers - disciplined DCF, intrinsic worth.",
    accent: "#60a5fa",
    accentSoft: "rgba(96, 165, 250, 0.18)",
    gradientFrom: "#1e3a8a",
    gradientTo: "#0f172a",
  },
  "Bill Ackman": {
    role: "Activist Investor",
    tagline: "Concentrated, catalyst-driven, conviction at scale.",
    accent: "#fb923c",
    accentSoft: "rgba(251, 146, 60, 0.18)",
    gradientFrom: "#7c2d12",
    gradientTo: "#1c1917",
  },
  "Cathie Wood": {
    role: "Innovation Bull",
    tagline: "Disruption, exponential curves, conviction in the new.",
    accent: "#e879f9",
    accentSoft: "rgba(232, 121, 249, 0.18)",
    gradientFrom: "#701a75",
    gradientTo: "#1e1b4b",
  },
  "Charlie Munger": {
    role: "Mental Models",
    tagline: "Multidisciplinary filters, quality bias, and clear thinking.",
    accent: "#f59e0b",
    accentSoft: "rgba(245, 158, 11, 0.18)",
    gradientFrom: "#78350f",
    gradientTo: "#1c1917",
  },
  "Peter Lynch": {
    role: "Growth-at-Reasonable-Price",
    tagline: "Know what you own, scale winners, keep valuation discipline.",
    accent: "#22d3ee",
    accentSoft: "rgba(34, 211, 238, 0.18)",
    gradientFrom: "#164e63",
    gradientTo: "#082f49",
  },
  "Howard Marks": {
    role: "Cycles & Risk",
    tagline: "Second-level thinking - what is priced, what is missed.",
    accent: "#5eead4",
    accentSoft: "rgba(94, 234, 212, 0.18)",
    gradientFrom: "#134e4a",
    gradientTo: "#042f2e",
  },
  "Ray Dalio": {
    role: "Macro & Regimes",
    tagline: "Balance through cycles, probabilities, and diversification.",
    accent: "#38bdf8",
    accentSoft: "rgba(56, 189, 248, 0.18)",
    gradientFrom: "#075985",
    gradientTo: "#0c4a6e",
  },
  "Stanley Druckenmiller": {
    role: "Risk-Adjusted Conviction",
    tagline: "Aggressive when odds align, fast when thesis breaks.",
    accent: "#fb7185",
    accentSoft: "rgba(251, 113, 133, 0.18)",
    gradientFrom: "#881337",
    gradientTo: "#4c0519",
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
