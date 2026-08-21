"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { NasdaqRunModal, type NasdaqRunsResponse } from "@/components/shell/nasdaq-run-modal";
import { useWorkspace } from "@/components/shell/workspace-context";

type NasdaqRunContextValue = {
  access: NasdaqRunsResponse | null;
  liveRun: NasdaqRunsResponse["runs"][number] | null;
  open: () => void;
};

const NasdaqRunContext = createContext<NasdaqRunContextValue | null>(null);

export function useNasdaqRunModal(): NasdaqRunContextValue {
  const context = useContext(NasdaqRunContext);
  return context || { access: null, liveRun: null, open: () => undefined };
}

export function NasdaqRunProvider({ children }: { children: ReactNode }) {
  const { workspace } = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [access, setAccess] = useState<NasdaqRunsResponse | null>(null);

  useEffect(() => {
    if (workspace !== "nasdaq100") return;
    let canceled = false;
    fetch("/api/nasdaq100/runs", { cache: "no-store" })
      .then(async (response) => await response.json() as NasdaqRunsResponse)
      .then((payload) => {
        if (!canceled) setAccess(payload);
      })
      .catch(() => {
        if (!canceled) setAccess(null);
      });
    return () => {
      canceled = true;
    };
  }, [workspace]);

  useEffect(() => {
    if (workspace === "nasdaq100") return;
    const timer = window.setTimeout(() => setIsOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [workspace]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const liveRun = useMemo(
    () => access?.runs?.find((run) => run.status === "queued" || run.status === "running") || null,
    [access],
  );
  const value = useMemo<NasdaqRunContextValue>(() => ({ access, liveRun, open }), [access, liveRun, open]);

  return (
    <NasdaqRunContext.Provider value={value}>
      {children}
      <NasdaqRunModal
        open={workspace === "nasdaq100" && isOpen}
        onClose={close}
        initialData={access}
        onData={setAccess}
      />
    </NasdaqRunContext.Provider>
  );
}
