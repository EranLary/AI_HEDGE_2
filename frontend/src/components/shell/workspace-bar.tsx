"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Play } from "lucide-react";

import { NasdaqRunModal, type NasdaqRunsResponse } from "@/components/shell/nasdaq-run-modal";
import { useWorkspace } from "@/components/shell/workspace-context";
import { WORKSPACES, WORKSPACE_CONFIG, workspacePath, type Workspace } from "@/lib/workspace";

export function WorkspaceBar() {
  const { workspace } = useWorkspace();
  const pathname = usePathname() || `/${workspace}/reports`;
  const [runOpen, setRunOpen] = useState(false);
  const [access, setAccess] = useState<NasdaqRunsResponse | null>(null);

  useEffect(() => {
    if (workspace !== "nasdaq100") return;
    let canceled = false;
    fetch("/api/nasdaq100/runs", { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() as NasdaqRunsResponse }))
      .then(({ payload }) => {
        if (!canceled) setAccess(payload);
      })
      .catch(() => {
        if (!canceled) setAccess(null);
      });
    return () => { canceled = true; };
  }, [workspace]);

  const switchHref = (target: Workspace): string => {
    if (target === workspace) return pathname;
    const inner = pathname.replace(/^\/(?:analysis|nasdaq100)/, "") || "/reports";
    if (inner.startsWith("/dashboard") || inner.startsWith("/compare")) return workspacePath(target, "/reports");
    return workspacePath(target, inner);
  };

  const liveRun = useMemo(
    () => access?.runs?.find((run) => run.status === "queued" || run.status === "running") || null,
    [access],
  );

  return (
    <>
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--surface)] px-3 py-2 sm:px-6">
        <div className="flex items-center gap-2">
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

        {workspace === "nasdaq100" && access?.isAdmin ? (
          <div className="flex items-center gap-2">
            {liveRun ? (
              <span className="hidden text-xs text-[color:var(--text-muted)] sm:inline">
                {liveRun.completedCount}/{liveRun.requestedCount} complete
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setRunOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-on-accent)] transition hover:bg-[color:var(--accent-hover)] disabled:cursor-not-allowed disabled:text-[color:var(--text-disabled)] disabled:opacity-60"
            >
              <Play size={13} />
              Run
            </button>
          </div>
        ) : null}
      </div>
      <NasdaqRunModal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        initialData={access}
        onData={setAccess}
      />
    </>
  );
}
