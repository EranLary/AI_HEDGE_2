import { ReactNode } from "react";
import Link from "next/link";

import { AdminForbiddenError, requireAdmin } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminForbiddenError) {
      return <ForbiddenScreen email={err.email} />;
    }
    throw err;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-background)",
        color: "var(--color-foreground)",
      }}
    >
      <header
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <strong style={{ fontSize: 14, letterSpacing: 0.4, opacity: 0.8 }}>
          INTERNAL · OBSERVABILITY
        </strong>
        <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
          <Link href="/admin/observability">Runs</Link>
          <Link href="/">← Back to site</Link>
        </nav>
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
          ? `${email} is not on the admin allowlist.`
          : "You need to sign in to access this area."}
      </p>
      <p style={{ opacity: 0.6, fontSize: 13 }}>
        Add your email to <code>ADMIN_EMAILS</code> in <code>.env</code> (comma-separated) and restart the dev server.
      </p>
    </div>
  );
}
