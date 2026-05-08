"use client";

import { signIn } from "next-auth/react";
import { UserRound } from "lucide-react";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8431 2.0782-1.7977 2.7164v2.2581h2.9087c1.7018-1.5668 2.6854-3.874 2.6854-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9568-2.18l-2.9087-2.2581c-.806.54-1.8368.86-3.0481.86-2.344 0-4.3282-1.5832-5.0359-3.7104H.9573v2.3318C2.4382 15.9831 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.9641 10.7115C3.7841 10.1715 3.6818 9.5946 3.6818 9c0-.5946.1023-1.1715.2823-1.7115V4.9568H.9573C.3473 6.1731 0 7.5477 0 9s.3473 2.8268.9573 4.0431l3.0068-2.3316z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9568l3.0068 2.3318C4.6718 5.1627 6.656 3.5795 9 3.5795z"
      />
    </svg>
  );
}

export function SignInButton({ callbackUrl = "/" }: { callbackUrl?: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl })}
      className="hib-google-btn flex w-full items-center justify-center gap-3 rounded-xl px-6 py-3 text-sm font-semibold tracking-tight"
    >
      <GoogleMark />
      <span>Continue with Google</span>
    </button>
  );
}

export function GuestSignInButton({ callbackUrl = "/" }: { callbackUrl?: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        const safePath = callbackUrl.startsWith("/") ? callbackUrl : "/";
        const res = await signIn("guest", { callbackUrl: safePath, redirect: false });
        const nextUrl = res?.url || safePath;
        try {
          const parsed = new URL(nextUrl, window.location.origin);
          window.location.assign(`${parsed.pathname}${parsed.search}${parsed.hash}`);
        } catch {
          window.location.assign(safePath);
        }
      }}
      className="hib-google-btn flex w-full items-center justify-center gap-3 rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold tracking-tight text-zinc-100 hover:bg-white/10"
    >
      <UserRound size={18} />
      <span>Continue as Guest</span>
    </button>
  );
}
