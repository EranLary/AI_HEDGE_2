import { ReactNode } from "react";
import Link from "next/link";

import { signOut } from "@/auth";
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

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 13, letterSpacing: 0.4, opacity: 0.8 }}>
          INTERNAL · OBSERVABILITY
        </strong>
        <nav style={{ display: "flex", gap: 16, fontSize: 14, flex: 1 }}>
          <Link href="/runs">Runs</Link>
          <Link href="/users">Manage users</Link>
        </nav>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{email}</span>
        <form action={signOutAction}>
          <button
            type="submit"
            style={{
              fontSize: 12,
              padding: "4px 10px",
              background: "transparent",
              color: "var(--color-foreground)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              opacity: 0.8,
            }}
          >
            Sign out
          </button>
        </form>
      </header>
      <main style={{ padding: 24 }}>{children}</main>
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
