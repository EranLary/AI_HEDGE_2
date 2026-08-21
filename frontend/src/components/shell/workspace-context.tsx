"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import {
  WORKSPACE_CONFIG,
  workspaceFromPathname,
  workspacePath,
  withWorkspaceQuery,
  type Workspace,
} from "@/lib/workspace";

type WorkspaceContextValue = {
  workspace: Workspace;
  label: string;
  href: (path?: string) => string;
  api: (url: string) => string;
};

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: "analysis",
  label: WORKSPACE_CONFIG.analysis.label,
  href: (path = "/reports") => workspacePath("analysis", path),
  api: (url) => withWorkspaceQuery(url, "analysis"),
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const workspace = workspaceFromPathname(pathname);
  const value = useMemo<WorkspaceContextValue>(() => ({
    workspace,
    label: WORKSPACE_CONFIG[workspace].label,
    href: (path = "/reports") => workspacePath(workspace, path),
    api: (url) => withWorkspaceQuery(url, workspace),
  }), [workspace]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}
