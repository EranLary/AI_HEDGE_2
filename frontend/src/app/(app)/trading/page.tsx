import { Suspense } from "react";

import { TradingDashboard } from "@/components/trading-dashboard";

export default function TradingPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[color:var(--text-muted)]">Loading trading controls...</div>}>
      <TradingDashboard />
    </Suspense>
  );
}
