import { Suspense, type ReactNode } from "react";

import { DashboardSkeleton } from "@/components/dashboard-chrome";

export default function DashboardTickerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-4 sm:px-8">
      <Suspense fallback={<DashboardSkeleton />}>{children}</Suspense>
    </div>
  );
}
