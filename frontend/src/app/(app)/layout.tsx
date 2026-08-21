import type { ReactNode } from "react";
import { headers } from "next/headers";

import { AppShell } from "@/components/shell/app-shell";
import { parseWorkspace } from "@/lib/workspace";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const workspace = parseWorkspace(requestHeaders.get("x-ai-hedge-workspace"));
  return <AppShell initialWorkspace={workspace}>{children}</AppShell>;
}
