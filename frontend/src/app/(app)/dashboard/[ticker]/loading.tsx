"use client";

import { DashboardSkeleton } from "@/components/dashboard-chrome";
import { useTickerContext } from "@/components/shell/ticker-context";

const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  info: "Info",
  overview: "Overview",
  valuation: "Valuation",
  financials: "Financials",
  market: "Market",
  "web-search": "Web Search",
  scenarios: "Bull vs Bear",
  "sec-qa": "SEC Q&A",
  "wall-st": "Wall St.",
  "technical-analysis": "Technical Analysis",
  "dream-team": "Dream Team",
  download: "Download",
  artifacts: "Artifacts",
};

export default function DashboardTabLoading() {
  const { activeSection } = useTickerContext();
  const sectionLabel = activeSection ? SECTION_LABELS[activeSection] : undefined;
  const message = sectionLabel ? `Loading ${sectionLabel}...` : "Loading dashboard...";

  return <DashboardSkeleton message={message} />;
}
