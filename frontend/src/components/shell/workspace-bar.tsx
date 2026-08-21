"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useWorkspace } from "@/components/shell/workspace-context";
import { WORKSPACES, WORKSPACE_CONFIG, workspacePath, type Workspace } from "@/lib/workspace";

export function WorkspaceBar() {
  const { workspace } = useWorkspace();
  const pathname = usePathname() || `/${workspace}/reports`;

  const switchHref = (target: Workspace): string => {
    const inner = pathname.replace(/^\/(?:analysis|nasdaq100)/, "") || "/reports";
    if (inner.startsWith("/dashboard") || inner.startsWith("/compare")) return workspacePath(target, "/reports");
    return workspacePath(target, inner);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--text-muted)] sm:inline">
        Workspace
      </span>
      <nav aria-label="Workspace" className="flex rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-elevated)] p-0.5">
        {WORKSPACES.map((item) => (
          <Link
            key={item}
            href={switchHref(item)}
            aria-current={workspace === item ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition ${
              workspace === item
                ? "bg-[color:var(--accent)] text-[color:var(--text-on-accent)]"
                : "text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            }`}
          >
            {WORKSPACE_CONFIG[item].label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
