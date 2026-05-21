import { ReactNode } from "react";

import { signOut } from "@/auth";
import { AppHeader } from "@/components/app-header";
import { SwRegister } from "@/components/sw-register";
import { AdminForbiddenError, requireAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/auth/signin" });
}

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  let email = "";
  try {
    ({ email } = await requireAdmin());
  } catch (err) {
    if (err instanceof AdminForbiddenError) {
      return <ForbiddenScreen email={err.email} />;
    }
    throw err;
  }

  const signOutSlot = (
    <form action={signOutAction}>
      <button type="submit" className="btn-ghost">
        Sign out
      </button>
    </form>
  );

  return (
    <div style={{ minHeight: "100vh" }}>
      <SwRegister />
      <AppHeader email={email} signOutSlot={signOutSlot} />
      <main className="app-main">{children}</main>
    </div>
  );
}

function ForbiddenScreen({ email }: { email: string }) {
  return (
    <div style={{ padding: 48, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>403 · Not authorised</h1>
      <p style={{ opacity: 0.8, marginBottom: 8 }}>
        {email
          ? `${email} is not on the obs admin allowlist.`
          : "You need to sign in to access this area."}
      </p>
      <p style={{ opacity: 0.6, fontSize: 13 }}>
        Ask an existing admin to add you at <code>/users</code>.
      </p>
    </div>
  );
}
