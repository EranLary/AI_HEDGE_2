export const WORKSPACES = ["analysis", "nasdaq100"] as const;

export type Workspace = (typeof WORKSPACES)[number];

export type WorkspaceConfig = {
  key: Workspace;
  label: string;
  benchmarkSymbol: string;
  benchmarkName: string;
  universeDescription: string;
};

export const WORKSPACE_CONFIG: Record<Workspace, WorkspaceConfig> = {
  analysis: {
    key: "analysis",
    label: "Analysis",
    benchmarkSymbol: "^SP500TR",
    benchmarkName: "S&P 500 Total Return",
    universeDescription: "Analyzed tickers with a report available in the trailing 90 days",
  },
  nasdaq100: {
    key: "nasdaq100",
    label: "Nasdaq 100",
    benchmarkSymbol: "QQQ",
    benchmarkName: "Invesco QQQ — total-return proxy",
    universeDescription: "Nasdaq 100 reports from active releases in the trailing 90 days",
  },
};

export function parseWorkspace(value: unknown): Workspace {
  return String(value || "").trim().toLowerCase() === "nasdaq100" ? "nasdaq100" : "analysis";
}

export function parseApiWorkspace(value: unknown): Workspace | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "analysis";
  return isWorkspace(normalized) ? normalized : null;
}

export function isWorkspace(value: unknown): value is Workspace {
  return WORKSPACES.includes(String(value || "").trim().toLowerCase() as Workspace);
}

export function workspacePath(workspace: Workspace, path = "/reports"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `/${workspace}${normalized === "/" ? "/reports" : normalized}`;
}

export function workspaceFromPathname(pathname: string | null | undefined): Workspace {
  const first = String(pathname || "").split("/").filter(Boolean)[0];
  return parseWorkspace(first);
}

export function withWorkspaceQuery(url: string, workspace: Workspace): string {
  const [path, hash = ""] = url.split("#", 2);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${workspace}${hash ? `#${hash}` : ""}`;
}
