"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

type ToastTone = "info" | "success" | "error";

type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
};

type ToastContextValue = {
  push: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { push: () => undefined };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, tone, message }].slice(-4));
  }, []);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 4000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const value = useMemo<ToastContextValue>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length ? (
        <div className="fixed right-3 bottom-4 z-[100] flex w-[280px] flex-col gap-2 sm:right-6">
          {toasts.map((toast) => {
            const base = "rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur-sm flex items-center gap-2";
            const toneCls =
              toast.tone === "success"
                ? "border-emerald-400/50 bg-emerald-500/18 text-emerald-50"
                : toast.tone === "error"
                ? "border-red-400/55 bg-red-500/20 text-red-50"
                : "border-white/20 bg-zinc-900/85 text-zinc-100";
            const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? XCircle : Info;
            return (
              <div key={toast.id} className={`${base} ${toneCls}`}>
                <Icon size={15} />
                <span>{toast.message}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
