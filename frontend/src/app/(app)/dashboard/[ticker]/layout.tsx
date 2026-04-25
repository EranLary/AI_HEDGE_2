import type { ReactNode } from "react";

export default function DashboardTickerLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-6 sm:px-8">{children}</div>;
}
