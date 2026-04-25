"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function DashboardIndexPage() {
  return (
    <Suspense fallback={null}>
      <DashboardIndexInner />
    </Suspense>
  );
}

function DashboardIndexInner() {
  const router = useRouter();
  const search = useSearchParams();
  const legacyTicker = search?.get("ticker");
  const legacyReport = search?.get("report");

  useEffect(() => {
    if (legacyTicker) {
      const suffix = legacyReport ? `?report=${encodeURIComponent(legacyReport)}` : "";
      router.replace(`/dashboard/${encodeURIComponent(legacyTicker.toUpperCase())}/overview${suffix}`);
      return;
    }
    router.replace("/reports");
  }, [legacyTicker, legacyReport, router]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 text-center text-sm text-zinc-400">
      Redirecting…
    </div>
  );
}
