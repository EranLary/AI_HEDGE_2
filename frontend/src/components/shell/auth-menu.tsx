"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { LogIn, LogOut, UserCircle2 } from "lucide-react";
import { signIn, signOut, useSession } from "next-auth/react";

export function AuthMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

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

  if (status === "loading") {
    return <div className="hib-auth-btn h-9 w-9 rounded-lg opacity-40" aria-hidden />;
  }

  if (!session?.user) {
    return (
      <button
        type="button"
        onClick={() => {
          const callbackUrl = window.location.pathname + window.location.search;
          window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
        }}
        className="hib-auth-btn inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs uppercase tracking-[0.12em]"
      >
        <LogIn size={14} />
        <span className="hidden sm:inline">Sign in</span>
      </button>
    );
  }

  const { name, email, image, isGuest } = session.user;
  const display = isGuest ? "Guest" : name || email || "Account";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="hib-auth-btn inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs uppercase tracking-[0.12em]"
      >
        {image ? (
          <Image
            src={image}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 rounded-full"
            unoptimized
          />
        ) : (
          <UserCircle2 size={20} />
        )}
        <span className="hidden sm:inline max-w-[10rem] truncate normal-case tracking-normal">
          {display}
        </span>
      </button>
      {open ? (
        <div className="hib-auth-menu absolute right-0 top-full z-50 mt-2 w-64 rounded-xl p-2 shadow-xl">
          <div className="px-3 py-2 text-xs">
            <div className="truncate font-medium text-zinc-100">{isGuest ? "Guest session" : name || "Signed in"}</div>
            {email ? <div className="truncate text-zinc-400">{email}</div> : null}
            {isGuest ? <div className="mt-0.5 text-zinc-400">Read-only for new analysis runs</div> : null}
          </div>
          {isGuest ? (
            <>
              <div className="my-1 border-t border-white/10" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  signIn("google", { callbackUrl: window.location.pathname + window.location.search });
                }}
                className="hib-auth-menu-item flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm"
              >
                <LogIn size={14} />
                <span>Sign in with Google</span>
              </button>
            </>
          ) : null}
          <div className="my-1 border-t border-white/10" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut({ callbackUrl: "/" });
            }}
            className="hib-auth-menu-item flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm"
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
