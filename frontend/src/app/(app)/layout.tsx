import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
