"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import {
  WORKSPACE_CONFIG,
  isWorkspace,
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

export function WorkspaceProvider({ children, initialWorkspace }: { children: ReactNode; initialWorkspace: Workspace }) {
  const pathname = usePathname();
  const firstSegment = String(pathname || "").split("/").filter(Boolean)[0];
  // Middleware supplies the initial value because SSR sees the rewritten inner
  // page path. Once hydrated, the canonical browser pathname takes precedence.
  const workspace = isWorkspace(firstSegment) ? firstSegment : initialWorkspace;
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
