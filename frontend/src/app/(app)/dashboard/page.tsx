"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWorkspace } from "@/components/shell/workspace-context";

export default function DashboardIndexPage() {
  return (
    <Suspense fallback={null}>
      <DashboardIndexInner />
    </Suspense>
  );
}

function DashboardIndexInner() {
  const router = useRouter();
  const { href } = useWorkspace();
  const search = useSearchParams();
  const legacyTicker = search?.get("ticker");
  const legacyReport = search?.get("report");

  useEffect(() => {
    if (legacyTicker) {
      const suffix = legacyReport ? `?report=${encodeURIComponent(legacyReport)}` : "";
      router.replace(`${href(`/dashboard/${encodeURIComponent(legacyTicker.toUpperCase())}/summary`)}${suffix}`);
      return;
    }
    router.replace(href("/reports"));
  }, [href, legacyTicker, legacyReport, router]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 text-center text-sm text-zinc-400">
      Redirecting…
    </div>
  );
}
