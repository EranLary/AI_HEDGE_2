"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type NewRunModalContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const NewRunModalContext = createContext<NewRunModalContextValue | null>(null);

export function useNewRunModal(): NewRunModalContextValue {
  const ctx = useContext(NewRunModalContext);
  if (!ctx) {
    return { isOpen: false, open: () => undefined, close: () => undefined };
  }
  return ctx;
}

export function NewRunProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<NewRunModalContextValue>(() => ({ isOpen, open, close }), [isOpen, open, close]);

  return <NewRunModalContext.Provider value={value}>{children}</NewRunModalContext.Provider>;
}
