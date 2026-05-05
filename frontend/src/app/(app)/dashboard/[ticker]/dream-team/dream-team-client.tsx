"use client";

import type { DashboardPayload, ReportListItem } from "@/lib/dashboard-types";
import { buildCurrencyContext } from "@/components/hedge-dashboard";
import { PersonaGallery } from "@/components/dream-team/persona-gallery";

export type DreamTeamClientProps = {
  ticker: string;
  data: DashboardPayload;
  reportsForTicker: ReportListItem[];
  resolvedReportId: string;
  liveCurrentPrice: number | null;
};

export function DreamTeamClient({
  ticker,
  data,
  reportsForTicker,
  resolvedReportId,
  liveCurrentPrice,
}: DreamTeamClientProps) {
  const ctx = buildCurrencyContext(data);
  const team = data.dream_team || [];
  const currentPrice = data.valuation_hub.consensus?.current_price;
  const dreamTab = (data.valuation_hub.method_tabs || []).find((tab) => tab.name === "Dream Team");
  const dreamOutputs = dreamTab?.outputs || [];

  return (
    <PersonaGallery
      personas={team}
      dreamOutputs={dreamOutputs}
      ctx={ctx}
      currentPrice={typeof currentPrice === "number" ? currentPrice : null}
      liveCurrentPrice={liveCurrentPrice}
      ticker={ticker}
      reports={reportsForTicker}
      currentReportId={resolvedReportId}
    />
  );
}
