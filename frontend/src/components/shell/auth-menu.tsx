"use client";

import { useEffect, useRef, useState } from "react";
import { LogIn, UserCircle2, UserPlus } from "lucide-react";
import { useToast } from "@/components/shell/toast";

export function AuthMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const { push } = useToast();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="hib-auth-btn inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs uppercase tracking-[0.12em]"
      >
        <UserCircle2 size={14} />
        <span className="hidden sm:inline">Sign in</span>
      </button>
      {open ? (
        <div className="hib-auth-menu absolute right-0 top-full z-50 mt-2 w-64 rounded-xl p-2 shadow-xl">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              push("Sign-in coming soon", "info");
            }}
            className="hib-auth-menu-item flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm"
          >
            <LogIn size={14} />
            <span>Sign in</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              push("Accounts coming soon", "info");
            }}
            className="hib-auth-menu-item flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm"
          >
            <UserPlus size={14} />
            <span>Create account</span>
          </button>
          <div className="my-1 border-t border-white/10" />
          <div className="px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Account</div>
          <div aria-disabled className="hib-auth-menu-item flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm opacity-40" style={{ cursor: "not-allowed" }}>
            <span>Profile</span>
          </div>
          <div aria-disabled className="hib-auth-menu-item flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm opacity-40" style={{ cursor: "not-allowed" }}>
            <span>Settings</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
