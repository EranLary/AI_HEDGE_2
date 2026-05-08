import type { CSSProperties } from "react";

export const STAGE_ORDER = [
  "analyst",
  "sec.qa",
  "sec.short",
  "dashboard.extract",
  "valuations",
  "technical",
  "unknown",
];

export function stageColor(stage: string): string {
  if (stage.startsWith("persona")) return "#fbbf24";
  if (stage.startsWith("sec")) return "#a78bfa";
  if (stage.startsWith("valuation")) return "#34d399";
  if (stage === "analyst") return "#60a5fa";
  if (stage === "technical") return "#f87171";
  if (stage.startsWith("dashboard")) return "#22d3ee";
  return "#94a3b8";
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  running: { bg: "rgba(99,102,241,0.18)", fg: "#a5b4fc" },
  success: { bg: "rgba(34,197,94,0.18)", fg: "#86efac" },
  error: { bg: "rgba(239,68,68,0.18)", fg: "#fca5a5" },
};

export function statusPillStyle(status: string): CSSProperties {
  const s = STATUS_COLORS[status] ?? { bg: "rgba(148,163,184,0.18)", fg: "#cbd5e1" };
  return {
    background: s.bg,
    color: s.fg,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    display: "inline-block",
    lineHeight: 1.6,
  };
}
